#!/usr/bin/env python3
"""Offline tests for ot-linux-qa.py. Run: python3 -B scripts/ot-linux-qa.test.py -v

Pure fixtures only. Popen and socket are replaced with tripwires, so nothing here
can start a browser, a sandbox, a build or a network connection, even on Linux.
"""
import copy
import importlib.util
import os
import pathlib
import re
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPEC = importlib.util.spec_from_file_location("ot_linux_qa", HERE / "ot-linux-qa.py")
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)

OID_A = "a" * 40
OID_B = "b" * 40
HEAD = "c" * 40
CI_HEAD = (ROOT / qa.CI_PATH).read_bytes().decode("utf-8")
CI_BASE = qa.split_ci(CI_HEAD)[0]


def refuse(*_args, **_kwargs):
    raise AssertionError("offline test tried to start a process or open a socket")


PATCHES = [mock.patch.object(subprocess, "Popen", refuse), mock.patch.object(qa.socket, "socket", refuse)]


def setUpModule():
    for patch in PATCHES:
        patch.start()


def tearDownModule():
    for patch in PATCHES:
        patch.stop()


def good_fence():
    fence = {
        "loopback": {"ok": True, "status": 200},
        "offbox": [{"name": t[0], "target": "x", "errno": "ENETUNREACH", "connected": False, "timeout": False}
                   for t in qa.OFFBOX_TARGETS],
        "tripwire": {"readable": False, "errno": "ENOENT"},
        "readonly": {p: "EROFS" for p in qa.NS_READONLY_PROBES},
        "tmp_write": {"ok": True},
        "exposed": [],
        "canary_seen": False,
        "env_problems": [],
    }
    fence["problems"] = qa.evaluate_fence(fence)
    return fence


def good_evidence():
    return {
        "ok": True,
        "cases": {name: {"status": "pass"} for name in qa.EXPECTED_CASES},
        "control": {"ok": True},
        "counts": {"controlPosts": 1, "continuedPosts": 0, "continuedNonGet": 0,
                   "unrouted": 0, "pageErrors": 0, "popups": 0},
    }


def good_tree():
    return {"app/page.tsx": ("100644", "blob", OID_A), ".env.example": ("100644", "blob", OID_B)}


def with_ci(tree, text=CI_BASE):
    return {**tree, qa.CI_PATH: ("100644", "blob", qa.blob_oid(text.encode()))}


def with_qa(tree):
    return with_ci({**tree, **{p: ("100644", "blob", OID_B) for p in qa.QA_FILES}}, CI_HEAD)


class SourcePin(unittest.TestCase):
    def evaluate(self, **overrides):
        args = dict(ref=qa.BRANCH_REF, sha=HEAD, head=HEAD, is_ancestor=True, porcelain="",
                    pin_tree=with_ci(good_tree()), head_tree=with_qa(good_tree()), pin_tree_oid=qa.PIN_TREE,
                    baseline_ci=CI_BASE, head_ci=CI_HEAD)
        args.update(overrides)
        return qa.evaluate_source(**args)

    def test_descendant_with_exactly_the_four_files_passes(self):
        self.assertEqual(self.evaluate(), [])

    def test_wrong_branch(self):
        self.assertTrue(self.evaluate(ref="refs/heads/main"))

    def test_pin_not_ancestor(self):
        self.assertTrue(self.evaluate(is_ancestor=False))

    def test_dirty_tree(self):
        self.assertTrue(self.evaluate(porcelain=" M package.json\n"))

    def test_head_must_be_dispatched_commit(self):
        self.assertTrue(self.evaluate(sha="d" * 40))

    def test_changed_app_file_fails(self):
        head = with_qa(good_tree())
        head["app/page.tsx"] = ("100644", "blob", OID_B)
        self.assertEqual(self.evaluate(head_tree=head), ["changed: app/page.tsx"])

    def test_mode_change_fails(self):
        head = with_qa(good_tree())
        head["app/page.tsx"] = ("100755", "blob", OID_A)
        self.assertEqual(self.evaluate(head_tree=head), ["changed: app/page.tsx"])

    def test_extra_file_is_not_excluded(self):
        head = with_qa(good_tree())
        head["scripts/ot-linux-other.py"] = ("100644", "blob", OID_B)
        self.assertEqual(self.evaluate(head_tree=head), ["added: scripts/ot-linux-other.py"])

    def test_removed_file_and_missing_qa_file(self):
        head = with_qa(good_tree())
        del head["app/page.tsx"]
        del head["scripts/ot-linux-qa.py"]
        self.assertEqual(sorted(self.evaluate(head_tree=head)),
                         ["qa file missing: scripts/ot-linux-qa.py", "removed: app/page.tsx"])

    def test_missing_pin_tree_fails_closed(self):
        self.assertIn("pin tree unavailable", self.evaluate(pin_tree={}))

    def test_ls_tree_parser(self):
        text = f"100644 blob {OID_A}\ta b.txt\x00100755 blob {OID_B}\tx\x00"
        self.assertEqual(qa.parse_ls_tree(text), {"a b.txt": ("100644", "blob", OID_A), "x": ("100755", "blob", OID_B)})

    def test_env_paths_leave_the_stage(self):
        self.assertEqual(set(qa.expected_stage_tree(good_tree())), {"app/page.tsx"})

    def test_stage_tree_detects_byte_and_mode_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp, "f.txt")
            path.write_bytes(b"hello")
            os.chmod(path, 0o644)
            entry = ("100644", "blob", qa.blob_oid(b"hello"))
            self.assertEqual(qa.stage_tree_problems(tmp, {"f.txt": entry}), [])
            path.write_bytes(b"other")
            self.assertEqual(qa.stage_tree_problems(tmp, {"f.txt": entry}), ["stage differs: f.txt"])
            self.assertEqual(qa.stage_tree_problems(tmp, {"f.txt": entry}, frozenset({"f.txt"})), [])
            self.assertEqual(qa.stage_tree_problems(tmp, {"gone": entry}), ["stage missing: gone"])

    def test_blob_oid_matches_git(self):
        self.assertEqual(qa.blob_oid(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")


class BuildChecks(unittest.TestCase):
    def test_real_wrapper_has_no_migration(self):
        self.assertEqual(qa.wrapper_problems((ROOT / qa.BUILD_WRAPPER).read_text()), [])

    def test_added_migration_is_refused(self):
        text = 'execSync("prisma migrate deploy")\nexecSync("prisma generate")\nexecSync("next build")\n'
        self.assertTrue(qa.wrapper_problems(text))

    def test_compile_only_output_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "BUILD_ID").write_text("x")
            self.assertTrue(qa.build_output_problems(tmp))


class Bwrap(unittest.TestCase):
    NODE = "/opt/hostedtoolcache/node/24.0.0/x64"

    def setUp(self):
        self.layout = qa.Layout("/w/_temp/ot-qa")

    def argv(self, mode):
        return qa.build_bwrap_argv(self.layout, self.NODE, mode, ["/usr/bin/python3", "x"], 9)

    def test_real_argv_is_allowed_in_both_modes(self):
        for mode in ("build", "runtime"):
            self.assertEqual(qa.bwrap_problems(self.argv(mode), self.layout, self.NODE, mode), [])

    def test_runtime_source_is_read_only(self):
        argv = self.argv("runtime")
        at = argv.index(str(self.layout.app))
        self.assertEqual(argv[at - 1], "--ro-bind")

    def test_never_mounts_host_root_home_or_run(self):
        for mode in ("build", "runtime"):
            sources = [a for i, a in enumerate(self.argv(mode)) if self.argv(mode)[i - 1] in ("--ro-bind", "--bind")]
            self.assertFalse({"/", "/home", "/run", "/etc", "/root", "/var"} & set(sources))

    def test_forbidden_changes_are_refused(self):
        insert = {
            "root bind": ["--ro-bind", "/", "/host"],
            "home bind": ["--bind", "/home", "/home"],
            "run bind": ["--ro-bind", "/run", "/run"],
            "workspace": ["--ro-bind", "/w/repo/.git", "/qa/.git"],
            "share net": ["--share-net"],
            "cap add": ["--cap-add", "ALL"],
            "dev bind": ["--dev-bind", "/dev", "/dev"],
            "secret env": ["--setenv", "STRIPE_SECRET_KEY", "x"],
            "real dsn": ["--setenv", "DATABASE_URL", "postgresql://real"],
        }
        for label, extra in insert.items():
            argv = self.argv("runtime")
            argv[1:1] = extra
            self.assertTrue(qa.bwrap_problems(argv, self.layout, self.NODE, "runtime"), label)

    def test_runtime_refuses_writable_source(self):
        argv = self.argv("runtime")
        argv[argv.index(str(self.layout.app)) - 1] = "--bind"
        self.assertTrue(qa.bwrap_problems(argv, self.layout, self.NODE, "runtime"))

    def test_required_isolation_cannot_be_dropped(self):
        for flag in ("--unshare-all", "--unshare-user", "--die-with-parent", "--clearenv"):
            argv = [a for a in self.argv("runtime") if a != flag]
            self.assertTrue(qa.bwrap_problems(argv, self.layout, self.NODE, "runtime"), flag)

    def test_userns_policy(self):
        self.assertEqual(qa.assess_userns(None, None, "1000"), [])
        self.assertEqual(qa.assess_userns("1\n", "0\n", "1000\n"), [])
        self.assertTrue(qa.assess_userns("0", None, "1000"))
        self.assertTrue(qa.assess_userns(None, "1", "1000"))
        self.assertTrue(qa.assess_userns(None, None, "0"))
        self.assertTrue(qa.assess_userns(None, None, None))

    def test_setuid_bwrap_and_root_are_refused(self):
        self.assertEqual(qa.bwrap_binary_problems(0o100755, 1001), [])
        self.assertTrue(qa.bwrap_binary_problems(0o104755, 1001))
        self.assertTrue(qa.bwrap_binary_problems(0o100755, 0))

    def test_node_root_is_public_tool_cache_only(self):
        self.assertEqual(qa.node_root_problems(self.NODE), [])
        self.assertTrue(qa.node_root_problems("/home/runner/.nvm/x"))


class EnvScrub(unittest.TestCase):
    def test_parent_environment_is_not_an_input(self):
        with mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk", "GITHUB_TOKEN": "t"}):
            env = qa.scrubbed_env(HOME="/owned")
        self.assertEqual(env, {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/owned"})

    def test_secret_keys_and_real_dsn_are_refused(self):
        for extra in ({"GITHUB_TOKEN": "x"}, {"RESEND_API_KEY": "x"}, {"DATABASE_URL": "postgresql://real"},
                      {"DIRECT_URL": "x"}, {"ACTIONS_ID_TOKEN_REQUEST_URL": "x"}):
            with self.assertRaises(qa.StageStop):
                qa.scrubbed_env(**extra)

    def test_namespace_env_has_only_allowed_keys(self):
        for mode in ("build", "runtime"):
            self.assertEqual(qa.env_key_problems(qa.namespace_env(mode), qa.NS_ENV_KEYS), [])
            self.assertEqual(qa.namespace_env(mode)["DATABASE_URL"], qa.SYNTHETIC_DSN)

    def test_child_env_gate(self):
        self.assertEqual(qa.env_key_problems(["PATH", "__NEXT_PRIVATE_ORIGIN", "PW_X"], qa.NS_ENV_KEYS), [])
        self.assertTrue(qa.env_key_problems(["PATH", "RUNNER_TEMP"], qa.NS_ENV_KEYS))

    def test_prepare_steps_are_public_only(self):
        layout = qa.Layout("/w/_temp/ot-qa")
        steps = qa.prepare_steps(layout, "/opt/hostedtoolcache/node/24/x64")
        text = " ".join(" ".join(argv) for _label, argv, _env in steps)
        self.assertIn("ci --ignore-scripts", text)
        self.assertIn("install chromium --no-shell", text)
        for word in ("sysctl", "aa-", "apparmor", "setcap", "chmod", "--global", " -g "):
            self.assertNotIn(word, text)
        for _label, _argv, env in steps:
            self.assertEqual(env["DATABASE_URL"], qa.SYNTHETIC_DSN)


class NetworkOracle(unittest.TestCase):
    def offbox(self, **overrides):
        return {"name": "tcp4", "errno": "ENETUNREACH", "connected": False, "timeout": False, **overrides}

    def test_kernel_denials_pass(self):
        for name in ("ENETUNREACH", "EACCES", "EPERM"):
            self.assertTrue(qa.offbox_blocked(self.offbox(errno=name)))

    def test_refused_timeout_connected_and_unknown_fail(self):
        self.assertFalse(qa.offbox_blocked(self.offbox(errno="ECONNREFUSED")))
        self.assertFalse(qa.offbox_blocked(self.offbox(errno=None, timeout=True)))
        self.assertFalse(qa.offbox_blocked(self.offbox(errno="ENETUNREACH", timeout=True)))
        self.assertFalse(qa.offbox_blocked(self.offbox(errno=None, connected=True)))
        self.assertFalse(qa.offbox_blocked(self.offbox(errno="EHOSTUNREACH")))
        self.assertFalse(qa.offbox_blocked(self.offbox(errno="EAFNOSUPPORT")))

    def test_missing_probe_fails(self):
        self.assertTrue(qa.evaluate_offbox([]))

    def test_good_fence_passes_and_every_fault_is_detected(self):
        fence = good_fence()
        self.assertEqual(fence["problems"], [])
        for name, bad in qa.faulty_fences(fence):
            self.assertTrue(qa.evaluate_fence(bad), name)
        self.assertEqual(qa.detector_selftest(fence)["undetected"], [])

    def test_blind_detector_fails_selftest(self):
        with mock.patch.object(qa, "evaluate_fence", return_value=[]):
            self.assertFalse(qa.detector_selftest(good_fence())["ok"])

    def test_empty_fence_fails_closed(self):
        self.assertGreater(len(qa.evaluate_fence({})), 4)


class ChromiumGate(unittest.TestCase):
    CHROME = "/qa/browsers/chromium-1/chrome-linux/chrome"
    SANDBOX = (
        "Sandbox Status\nLayer 1 Sandbox\tNamespace\nPID namespaces\tYes\nNetwork namespaces\tYes\n"
        "Seccomp-BPF sandbox\tYes\nSeccomp-BPF sandbox supports TSYNC\tYes\nYou are adequately sandboxed.\n"
    )

    def processes(self):
        return [
            {"pid": 5, "argv": [self.CHROME, "--headless", "--user-data-dir=/tmp/profile"]},
            {"pid": 6, "argv": [self.CHROME, "--type=zygote", "--no-zygote-sandbox"]},
            {"pid": 7, "argv": [self.CHROME, "--type=zygote"]},
            {"pid": 8, "argv": [self.CHROME, "--type=gpu-process", "--no-zygote-sandbox"]},
            {"pid": 9, "argv": [self.CHROME, "--type=renderer"]},
        ]

    def test_good_tree_passes_and_finds_main(self):
        problems, main = qa.evaluate_chrome_processes(self.processes(), self.CHROME)
        self.assertEqual(problems, [])
        self.assertEqual(main["pid"], 5)

    def test_forbidden_flags_on_any_process(self):
        for flag in ("--no-sandbox", "--disable-setuid-sandbox", "--disable-namespace-sandbox",
                     "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--single-process",
                     "--no-zygote", "--disable-gpu-sandbox=1"):
            for index in (0, 4):
                processes = self.processes()
                processes[index]["argv"].append(flag)
                self.assertTrue(qa.evaluate_chrome_processes(processes, self.CHROME)[0], flag)

    def test_no_zygote_sandbox_only_on_its_owners(self):
        processes = self.processes()
        processes[4]["argv"].append("--no-zygote-sandbox")
        self.assertTrue(qa.evaluate_chrome_processes(processes, self.CHROME)[0])

    def test_missing_main_zygote_or_renderer(self):
        self.assertTrue(qa.evaluate_chrome_processes(self.processes()[1:], self.CHROME)[0])
        self.assertTrue(qa.evaluate_chrome_processes(self.processes()[:1], self.CHROME)[0])
        two = self.processes() + [{"pid": 10, "argv": [self.CHROME]}]
        self.assertTrue(qa.evaluate_chrome_processes(two, self.CHROME)[0])

    def retitled_titles(self):
        return {
            5: f"{self.CHROME} --headless --user-data-dir=/tmp/profile",
            6: f"{self.CHROME} --type=zygote --no-zygote-sandbox",
            7: f"{self.CHROME} --type=zygote",
            9: f"{self.CHROME} --type=renderer",
        }

    def evaluate_retitled(self, titles):
        """Each title is one cmdline element, read back through the real proc_argv."""
        with tempfile.TemporaryDirectory() as proc:
            processes = []
            for pid, title in titles.items():
                os.mkdir(f"{proc}/{pid}")
                pathlib.Path(f"{proc}/{pid}/cmdline").write_bytes(title.encode() + b"\0\0\0")
                processes.append({"pid": pid, "argv": qa.proc_argv(pid, proc)})
        return qa.evaluate_chrome_processes(processes, self.CHROME)

    def test_retitled_tree_passes_and_finds_main(self):
        problems, main = self.evaluate_retitled(self.retitled_titles())
        self.assertEqual(problems, [])
        self.assertEqual(main["pid"], 5)
        self.assertEqual(main["argv"], [self.CHROME, "--headless", "--user-data-dir=/tmp/profile"])

    def test_retitled_no_sandbox_rejected_on_main_and_renderer(self):
        for pid in (5, 9):
            titles = self.retitled_titles()
            titles[pid] += " --no-sandbox"
            problems, _main = self.evaluate_retitled(titles)
            self.assertEqual(problems, ["forbidden chromium flag: --no-sandbox"], pid)

    def test_retitled_no_zygote_sandbox_rejected_on_renderer(self):
        titles = self.retitled_titles()
        titles[9] += " --no-zygote-sandbox"
        problems, _main = self.evaluate_retitled(titles)
        self.assertEqual(problems, ["--no-zygote-sandbox on process type renderer"])

    def test_retitled_tree_without_zygote_or_renderer_fails(self):
        for pids, kind in (((6, 7), "zygote"), ((9,), "renderer")):
            titles = self.retitled_titles()
            for pid in pids:
                titles.pop(pid)
            problems, _main = self.evaluate_retitled(titles)
            self.assertEqual(problems, [f"no {kind} process observed"])

    def test_nul_separated_argv_is_not_retokenised(self):
        with tempfile.TemporaryDirectory() as proc:
            os.mkdir(f"{proc}/5")
            pathlib.Path(f"{proc}/5/cmdline").write_bytes(f"{self.CHROME}\0--title=a b\0".encode())
            self.assertEqual(qa.proc_argv(5, proc), [self.CHROME, "--title=a b"])

    def test_unreadable_or_empty_cmdline_is_empty_argv(self):
        with tempfile.TemporaryDirectory() as proc:
            self.assertEqual(qa.proc_argv(5, proc), [])
            os.mkdir(f"{proc}/6")
            pathlib.Path(f"{proc}/6/cmdline").write_bytes(b"")
            self.assertEqual(qa.proc_argv(6, proc), [])

    def test_native_sandbox_text(self):
        self.assertEqual(qa.evaluate_sandbox_text(self.SANDBOX), [])
        self.assertEqual(qa.evaluate_sandbox_text(
            self.SANDBOX.replace("Layer 1 Sandbox\tNamespace", "Namespace Sandbox\tYes")), [])

    def test_native_sandbox_negative_rows_fail(self):
        for bad in (("Layer 1 Sandbox\tNamespace", "Layer 1 Sandbox\tNone"),
                    ("Seccomp-BPF sandbox\tYes\n", "Seccomp-BPF sandbox\tNo\n"),
                    ("PID namespaces\tYes", "PID namespaces\tNo"),
                    ("Network namespaces\tYes", "Network namespaces\tNo"),
                    ("You are adequately sandboxed.", "You are NOT adequately sandboxed!")):
            self.assertTrue(qa.evaluate_sandbox_text(self.SANDBOX.replace(*bad)), bad)

    def test_seccomp_is_not_satisfied_by_the_tsync_row(self):
        text = self.SANDBOX.replace("Seccomp-BPF sandbox\tYes\n", "Seccomp-BPF sandbox\tNo\n")
        self.assertIn("Seccomp-BPF sandbox supports TSYNC\tYes", text)
        self.assertTrue(qa.evaluate_sandbox_text(text))

    def test_unknown_or_missing_page_fails_closed(self):
        self.assertTrue(qa.evaluate_sandbox_text(None))
        self.assertTrue(qa.evaluate_sandbox_text("sandbox page changed"))

    def test_same_namespace(self):
        ids = {"net": "net:[1]", "mnt": "mnt:[2]", "pid": "pid:[3]", "user": "user:[4]"}
        self.assertEqual(qa.namespace_problems("server", dict(ids), ids), [])
        self.assertTrue(qa.namespace_problems("server", {**ids, "net": "net:[9]"}, ids))
        self.assertTrue(qa.namespace_problems("server", {}, {}))

    def test_evidence_gate(self):
        self.assertEqual(qa.evaluate_browser_evidence(good_evidence()), [])
        self.assertTrue(qa.evaluate_browser_evidence(None))
        for mutate in (
            lambda e: e.update(ok=False),
            lambda e: e["cases"]["normal-mobile"].update(status="notrun"),
            lambda e: e["cases"].pop("malicious-desktop"),
            lambda e: e["cases"].update(extra={"status": "pass"}),
            lambda e: e.update(control=None),
            lambda e: e["counts"].update(controlPosts=0),
            lambda e: e["counts"].update(continuedPosts=1),
            lambda e: e["counts"].pop("unrouted"),
        ):
            evidence = copy.deepcopy(good_evidence())
            mutate(evidence)
            self.assertTrue(qa.evaluate_browser_evidence(evidence))


class FakeOps:
    def __init__(self, fence=None, server=None, browser=None, gate=None, ui=None, cleanup=None, raises=None):
        self.calls = []
        self.values = dict(controls=fence or good_fence(), start_server=server or {"problems": []},
                           start_browser=browser or {"problems": []}, browser_gate=gate or {"problems": []},
                           finish_browser=ui or {"problems": []}, cleanup=cleanup or {"ok": True})
        self.raises = raises
        self.written = None

    def __getattr__(self, name):
        if name not in self.values and name != "namespace_ids":
            raise AttributeError(name)

        def call():
            self.calls.append(name)
            if name == self.raises:
                raise RuntimeError("boom")
            return self.values.get(name, {"net": "net:[1]"})
        return call

    def release(self, go):
        self.calls.append(f"release:{go}")

    def write(self, ev):
        self.calls.append("write")
        self.written = copy.deepcopy(ev)


class Lifecycle(unittest.TestCase):
    def test_success_order_and_cleanup_precede_verdict(self):
        ops = FakeOps()
        ev = qa.run_inner(ops)
        self.assertEqual(ops.calls, ["namespace_ids", "controls", "start_server", "start_browser", "browser_gate",
                                     "release:True", "finish_browser", "cleanup", "write"])
        self.assertEqual(ev["status"], "PASS")
        self.assertEqual(ops.written["status"], "PASS")

    def test_failed_control_stops_before_server_and_browser(self):
        fence = good_fence()
        fence["offbox"][0].update(errno="ECONNREFUSED")
        fence["problems"] = qa.evaluate_fence(fence)
        ops = FakeOps(fence=fence)
        ev = qa.run_inner(ops)
        self.assertEqual(ev["status"], "HOLD")
        self.assertNotIn("start_server", ops.calls)
        self.assertNotIn("start_browser", ops.calls)
        self.assertEqual((ev["browser"], ev["ui"]), ("notrun", "notrun"))
        self.assertIn("cleanup", ops.calls)

    def test_blind_detector_stops_before_browser(self):
        ops = FakeOps()
        with mock.patch.object(qa, "detector_selftest", return_value={"ok": False}):
            ev = qa.run_inner(ops)
        self.assertEqual(ev["status"], "HOLD")
        self.assertNotIn("start_browser", ops.calls)

    def test_gate_failure_tells_driver_to_stop_before_ui(self):
        ops = FakeOps(gate={"problems": ["no seccomp"]})
        ev = qa.run_inner(ops)
        self.assertEqual(ev["status"], "HOLD")
        self.assertIn("release:False", ops.calls)
        self.assertNotIn("finish_browser", ops.calls)

    def test_unsupported_chrome_is_hold_not_pass(self):
        ops = FakeOps(browser={"problems": ["unsupported"]})
        self.assertEqual(qa.run_inner(ops)["status"], "HOLD")
        self.assertNotIn("browser_gate", ops.calls)

    def test_ui_failure_is_fail(self):
        self.assertEqual(qa.run_inner(FakeOps(ui={"problems": ["case"]}))["status"], "FAIL")

    def test_cleanup_failure_revokes_pass(self):
        ops = FakeOps(cleanup={"ok": False, "remaining_pids": [9]})
        self.assertEqual(qa.run_inner(ops)["status"], "FAIL")

    def test_cleanup_exception_revokes_pass(self):
        ops = FakeOps(raises="cleanup")
        ev = qa.run_inner(ops)
        self.assertEqual(ev["status"], "FAIL")
        self.assertIs(ev["cleanup"]["ok"], False)

    def test_exception_still_cleans_up(self):
        ops = FakeOps(raises="start_server")
        ev = qa.run_inner(ops)
        self.assertEqual(ev["status"], "FAIL")
        self.assertIn("boom", ev["error"])
        self.assertIn("cleanup", ops.calls)

    def final(self, **overrides):
        args = dict(stages={"validate": "PASS", "prepare": "PASS", "build": "PASS"},
                    inner={"status": "PASS", "cleanup": {"ok": True}}, host_cleanup=[], artifact={"problems": []})
        args.update(overrides)
        return qa.final_gate(**args)

    def test_final_gate(self):
        self.assertEqual(self.final(), ("PASS", []))
        self.assertEqual(self.final(stages={"validate": "PASS"})[0], "FAIL")
        self.assertEqual(self.final(inner=None)[0], "FAIL")
        self.assertEqual(self.final(inner={"status": "HOLD", "cleanup": {"ok": True}})[0], "HOLD")
        self.assertEqual(self.final(inner={"status": "PASS", "cleanup": {"ok": False}})[0], "FAIL")
        self.assertEqual(self.final(host_cleanup=["process remains"])[0], "FAIL")
        self.assertEqual(self.final(artifact={"problems": ["over cap"]})[0], "FAIL")
        self.assertEqual(self.final(artifact={})[0], "FAIL")


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeProc:
    pid = 4242

    def __init__(self, polls_until_exit=None, on_kill=None):
        self.left = polls_until_exit
        self.code = None

    def poll(self):
        if self.left is not None:
            if self.left <= 0:
                self.code = 0 if self.code is None else self.code
            self.left -= 1
        return self.code


class Bounded(unittest.TestCase):
    def run_fake(self, proc, timeout=10, cap=qa.LOG_CAP, setup=None):
        clock = FakeClock()
        signals = []

        def killpg(pid, sig):
            signals.append((pid, sig))
            proc.code = -sig

        def popen(*_args, **kwargs):
            self.assertEqual(kwargs["stderr"], subprocess.STDOUT)
            self.assertNotEqual(kwargs["stdout"], subprocess.PIPE)
            self.assertTrue(kwargs["start_new_session"])
            return proc

        with tempfile.TemporaryDirectory() as tmp:
            log = os.path.join(tmp, "log")
            if setup:
                setup(log)
            result = qa.run_bounded(["x"], log, timeout, {}, cap=cap, popen=popen, killpg=killpg,
                                    clock=clock, sleep=clock.sleep)
        return result, signals

    def test_normal_exit(self):
        result, signals = self.run_fake(FakeProc(polls_until_exit=2))
        self.assertTrue(qa.bounded_ok(result))
        self.assertEqual(signals, [])

    def test_watchdog_kills_group(self):
        result, signals = self.run_fake(FakeProc())
        self.assertEqual(result["reason"], "timeout")
        self.assertEqual(signals[0], (4242, qa.signal.SIGTERM))
        self.assertFalse(qa.bounded_ok(result))

    def test_log_cap_kills_group(self):
        result, signals = self.run_fake(FakeProc(), cap=3, setup=lambda log: pathlib.Path(log).write_text("xxxxx"))
        self.assertEqual(result["reason"], "log_cap")
        self.assertTrue(signals)

    def test_sigkill_after_ignored_sigterm(self):
        clock = FakeClock()
        signals = []
        proc = FakeProc()

        def killpg(pid, sig):
            signals.append(sig)
            if sig == qa.signal.SIGKILL:
                proc.code = -9
        qa.terminate_group(proc, killpg, clock, clock.sleep, grace=1.0)
        self.assertEqual(signals, [qa.signal.SIGTERM, qa.signal.SIGKILL])

    def test_listener_parser(self):
        # Real kernel shape: tx_queue:rx_queue and tr:tm->when are single columns.
        text = ("  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
                "   0: 0100007F:7947 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 "
                "0000000000000000 100 0 0 10 0\n")
        rows = qa.parse_proc_net_tcp(text)
        self.assertEqual(rows[0]["port"], 31047)
        self.assertEqual(rows[0]["address"], "0100007F")
        self.assertEqual(rows[0]["inode"], "12345")

    def test_listener_parser_never_reads_a_uid_as_the_inode(self):
        text = ("  sl  local_address rem_address st tx rx tr tm retrnsmt uid timeout inode\n"
                "   0: 0100007F:7947 00000000:0000 0A 0 0 0 0 0 1000 0 12345 1\n")
        self.assertEqual(qa.parse_proc_net_tcp(text), [])

    def test_host_cleanup(self):
        with tempfile.TemporaryDirectory() as proc:
            os.makedirs(f"{proc}/77/ns")
            os.symlink("net:[9]", f"{proc}/77/ns/net")
            clock = FakeClock()
            kwargs = dict(proc=proc, clock=clock, sleep=clock.sleep, wait=1.0)
            self.assertTrue(qa.host_cleanup_problems({"child-pid": 500}, "net:[9]", **kwargs))
            self.assertTrue(qa.host_cleanup_problems({"child-pid": 77}, "net:[8]", **kwargs))
            self.assertEqual(qa.host_cleanup_problems({"child-pid": 500}, "net:[8]", **kwargs), [])
            self.assertTrue(qa.host_cleanup_problems(None, "net:[8]", **kwargs))
            self.assertTrue(qa.host_cleanup_problems({"child-pid": 500}, None, **kwargs))

    def test_artifact_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "a.json").write_text("{}")
            self.assertEqual(qa.artifact_report(tmp, "NEEDLE")["problems"], [])
            pathlib.Path(tmp, "b.log").write_text("NEEDLE")
            self.assertTrue(qa.artifact_report(tmp, "NEEDLE")["problems"])
            os.unlink(f"{tmp}/b.log")
            pathlib.Path(tmp, "source.tar").write_text("x")
            self.assertTrue(qa.artifact_report(tmp)["problems"])

    def test_report_cap_drops_largest_first(self):
        with tempfile.TemporaryDirectory(), mock.patch.object(qa, "REPORT_CAP", 10):
            with tempfile.TemporaryDirectory() as tmp:
                pathlib.Path(tmp, "big.log").write_text("x" * 20)
                pathlib.Path(tmp, "small.json").write_text("{}")
                self.assertEqual(qa.enforce_report_cap(tmp), ["big.log"])
                self.assertEqual(os.listdir(tmp), ["small.json"])

    def test_meminfo(self):
        self.assertEqual(qa.parse_meminfo("MemTotal: 2 kB\nMemFree: 1 kB\nMemAvailable: 1 kB\n"),
                         {"MemTotal": 2048, "MemAvailable": 1024})


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = qa.split_ci(CI_HEAD)[1]
        cls.yaml = "\n".join(line for line in raw.splitlines() if not line.lstrip().startswith("#"))

    def test_trigger_is_manual_only(self):
        self.assertEqual(re.findall(r"(?m)^    if: .*$", self.yaml), [qa.CI_RUN_GUARD.rstrip("\n")])
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == ", qa.CI_RUN_GUARD)

    def test_permissions_and_no_credentials(self):
        self.assertRegex(CI_HEAD, r"(?m)^permissions:\n  contents: read$")
        for word in ("secrets.", "id-token", "environment:", "GITHUB_TOKEN", "github.token", "pull_request_target",
                     "permissions:"):
            self.assertNotIn(word, self.yaml)

    def test_no_privilege_widening(self):
        for word in ("privileged", "cap-add", "unconfined", "--network", "container:", "sysctl", "sudo",
                     "--no-sandbox", "npm install -g", "services:"):
            self.assertNotIn(word, self.yaml)

    def test_runner_and_timeouts(self):
        self.assertIn("runs-on: ubuntu-22.04", self.yaml)
        minutes = [int(n) for n in re.findall(r"timeout-minutes: (\d+)", self.yaml)]
        self.assertEqual(minutes[0], 15)
        self.assertLessEqual(max(minutes), 15)

    def test_checkout_settings(self):
        self.assertIn("persist-credentials: false", self.yaml)
        self.assertIn("fetch-depth: 0", self.yaml)

    def test_branch_guard_fails_rather_than_skips(self):
        # The job-level guard is required now; the exact shell test still fails what it lets through.
        guard = self.yaml.index(f'test "$REF" = "{qa.BRANCH_REF}"')
        self.assertLess(guard, self.yaml.index("actions/checkout@"))
        self.assertLess(self.yaml.index('test "$EVENT" = "workflow_dispatch"'), self.yaml.index("actions/checkout@"))

    def test_stages_run_in_fail_closed_order_with_scrubbed_env(self):
        order = [self.yaml.index(f"ot-linux-qa.py {s}") for s in ("validate", "prepare", "build", "run", "seal")]
        self.assertEqual(order, sorted(order))
        self.assertEqual(self.yaml.count("env -i PATH=/usr/bin:/bin /usr/bin/python3 -I"), 5)
        self.assertEqual(self.yaml.count("if: always()"), 1)
        self.assertGreater(self.yaml.index("if: always()"), self.yaml.index("ot-linux-qa.py run"))

    def test_upload_is_the_report_directory_only(self):
        # ci-workflow-contract.test.ts allows no upload action, so nothing leaves but the log excerpt.
        self.assertNotIn("upload-artifact", CI_HEAD)
        self.assertEqual(re.findall(r"^\s+path: (.*)$", self.yaml, re.M), [])
        self.assertEqual(self.yaml.count('--root "$RUNNER_TEMP/ot-qa"'), 5)
        with tempfile.TemporaryDirectory() as tmp:
            pathlib.Path(tmp, "RESULT.json").write_text('{"status": "HOLD"}')
            pathlib.Path(tmp, "browser-evidence.json").write_text("x" * (qa.EXCERPT_CAP + 1) + "CUT")
            pathlib.Path(tmp, "server.log").write_text("UNNAMED")
            lines = qa.report_excerpt(tmp)
        self.assertIn('{"status": "HOLD"}', lines)
        self.assertIn("--- inner.json: absent", lines)
        self.assertIn("--- browser-evidence.json (truncated)", lines)
        self.assertNotIn("CUT", "".join(lines))
        self.assertNotIn("UNNAMED", "".join(lines))


def ci_jobs():
    return dict(re.findall(r"(?m)^  ([\w-]+):\n    name: .*\n    if: (.*)$", CI_HEAD))


def job_runs(expression, event, ref):
    """Evaluates the real `if:` text. GitHub ignores case when comparing strings."""
    match = re.fullmatch(r"github\.event_name (==|!=) '([^']*)' (&&|\|\|) github\.ref (==|!=) '([^']*)'", expression)
    first_op, want_event, join, second_op, want_ref = match.groups()
    first = (event.casefold() == want_event.casefold()) == (first_op == "==")
    second = (ref.casefold() == want_ref.casefold()) == (second_op == "==")
    return (first and second) if join == "&&" else (first or second)


class CiTruthTable(unittest.TestCase):
    EXISTING = ("verify", "recovery-restore-matrix")
    # Every one of these must behave exactly as the original workflow does.
    DEFAULT_CI = (
        ("workflow_dispatch", "refs/heads/main"),
        ("workflow_dispatch", "refs/heads/feature"),
        ("workflow_dispatch", "refs/heads/abigail/ot-503-canonical-20261106-2"),
        ("workflow_dispatch", "refs/heads/abigail/ot-503-canonical-2026110"),
        ("workflow_dispatch", "refs/heads/abigail/ot-503-canonical"),
        ("workflow_dispatch", "refs/heads/x/abigail/ot-503-canonical-20261106"),
        ("workflow_dispatch", "refs/tags/abigail/ot-503-canonical-20261106"),
        ("workflow_dispatch", "abigail/ot-503-canonical-20261106"),
        ("workflow_dispatch", "refs/heads/abigail/ot-503-canonical-20261106 "),
        ("workflow_dispatch", ""),
        ("push", "refs/heads/main"),
        ("push", qa.BRANCH_REF),
        ("pull_request", "refs/pull/1/merge"),
        ("pull_request", "refs/pull/999/head"),
        ("pull_request", qa.BRANCH_REF),
        ("workflow_dispatch_x", qa.BRANCH_REF),
        ("schedule", qa.BRANCH_REF),
        ("", qa.BRANCH_REF),
    )

    def test_three_guarded_jobs_are_read_from_the_real_file(self):
        self.assertEqual(set(ci_jobs()), {*self.EXISTING, "browser-qa"})

    def test_exact_manual_runs_only_qa(self):
        jobs = ci_jobs()
        self.assertTrue(job_runs(jobs["browser-qa"], "workflow_dispatch", qa.BRANCH_REF))
        for name in self.EXISTING:
            self.assertFalse(job_runs(jobs[name], "workflow_dispatch", qa.BRANCH_REF), name)

    def test_everything_else_is_default_ci_without_qa(self):
        jobs = ci_jobs()
        for event, ref in self.DEFAULT_CI:
            self.assertFalse(job_runs(jobs["browser-qa"], event, ref), (event, ref))
            for name in self.EXISTING:
                self.assertTrue(job_runs(jobs[name], event, ref), (name, event, ref))

    def test_every_non_exact_ref_is_refused_by_the_source_gate(self):
        for _event, ref in self.DEFAULT_CI:
            if ref != qa.BRANCH_REF:
                problems = SourcePin("evaluate").evaluate(ref=ref)
                self.assertEqual(problems, [f"wrong ref: {ref}"])

    def test_case_variant_enters_the_job_but_stops_in_the_exact_gates(self):
        # A documented gap of `==` in expressions: the job-level guard cannot see
        # case. Nothing of the QA runs, because the first step and validate can.
        variant = qa.BRANCH_REF.upper().replace("REFS/HEADS/", "refs/heads/")
        jobs = ci_jobs()
        self.assertTrue(job_runs(jobs["browser-qa"], "workflow_dispatch", variant))
        self.assertFalse(job_runs(jobs["verify"], "workflow_dispatch", variant))
        self.assertIn(f'test "$REF" = "{qa.BRANCH_REF}"', qa.split_ci(CI_HEAD)[1])
        self.assertEqual(SourcePin("evaluate").evaluate(ref=variant), [f"wrong ref: {variant}"])


class CiBaseline(unittest.TestCase):
    def source(self, **overrides):
        return SourcePin("evaluate").evaluate(**overrides)

    def test_additions_removed_is_the_accepted_baseline(self):
        self.assertEqual(qa.hashlib.sha256(CI_BASE.encode()).hexdigest(), qa.CI_BASELINE_SHA256)
        self.assertEqual(len(CI_BASE.splitlines()), 197)
        self.assertEqual(qa.ci_delta_problems(CI_BASE, CI_HEAD), [])

    def test_job_bodies_differ_only_by_one_guard_line_each(self):
        lines = CI_HEAD.split(qa.CI_QA_MARKER)[0].splitlines(keepends=True)
        guards = [i for i, line in enumerate(lines) if line == qa.CI_SKIP_GUARD]
        self.assertEqual([lines[i - 1] for i in guards], list(qa.CI_GUARDED_JOB_NAMES))
        self.assertEqual("".join(line for line in lines if line != qa.CI_SKIP_GUARD), CI_BASE)

    def test_events_and_top_level_are_untouched(self):
        self.assertEqual(CI_HEAD.split("\njobs:\n")[0], CI_BASE.split("\njobs:\n")[0])
        block = re.search(r"(?ms)^on:\n(.*?)^permissions:", CI_HEAD).group(1)
        self.assertEqual([line.strip() for line in block.splitlines() if not line.lstrip().startswith("#") and line],
                         ["pull_request:", "push:", "branches: [main]", "workflow_dispatch:"])
        self.assertNotIn("inputs", CI_HEAD)
        self.assertIn("group: ci-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
                      CI_HEAD)

    def test_every_other_ci_change_is_refused(self):
        name, skip = qa.CI_GUARDED_JOB_NAMES[0], qa.CI_SKIP_GUARD
        checkout = "          persist-credentials: false\n          fetch-depth: 0\n"
        job = "    runs-on: ubuntu-22.04\n    timeout-minutes: 15\n"
        for old, new in (
            ("  workflow_dispatch:\n\npermissions", "  workflow_dispatch:\n    inputs:\n      x:\n        type: string\n\npermissions"),
            ("branches: [main]", "branches: [main, develop]"),
            ("  contents: read\n\nconcurrency", "  contents: write\n\nconcurrency"),
            ("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", "cancel-in-progress: true"),
            (name + skip, name),
            (qa.CI_GUARDED_JOB_NAMES[1] + skip, qa.CI_GUARDED_JOB_NAMES[1]),
            (name + skip, name + skip.replace("||", "&&")),
            (name + skip, name + skip.replace("-20261106'", "'")),
            ("postgres: [17, 18]", "postgres: [17]"),
            ("fail-fast: false", "fail-fast: true"),
            ("timeout-minutes: 20", "timeout-minutes: 19"),
            ("run: npm test -- --ci --maxWorkers=2", "run: npm test -- --ci --maxWorkers=1"),
            ("\n", "\r\n"),
            (qa.CI_RUN_GUARD, "    if: github.event_name == 'workflow_dispatch'\n"),
            (qa.CI_RUN_GUARD, f"    if: startsWith(github.ref, '{qa.BRANCH_REF}')\n"),
            (qa.CI_RUN_GUARD, ""),
            ("runs-on: ubuntu-22.04", "runs-on: ubuntu-latest"),
            (job, job.replace("15", "16")),
            (job, job + "    needs: verify\n"),
            (job, job + "    environment: production\n"),
            (job, job + "    permissions:\n      contents: write\n"),
            (job, job + "    container: ubuntu\n"),
            (checkout, checkout + "          token: ${{ secrets.X }}\n"),
            ("          persist-credentials: false\n          fetch-depth", "          persist-credentials: true\n          fetch-depth"),
            ("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4"),
            ('scripts/ot-linux-qa.py run\n', 'scripts/ot-linux-qa.py run --no-sandbox\n'),
        ):
            mutated = CI_HEAD.replace(old, new) if old == "\n" else CI_HEAD.replace(old, new, 1)
            self.assertNotEqual(mutated, CI_HEAD, old)
            self.assertTrue(qa.ci_delta_problems(CI_BASE, mutated), old)

    def test_appended_steps_and_jobs_are_refused(self):
        for extra in ("      - run: npm test\n", "      - run: npm ci\n", "      - run: psql -c 'select 1'\n",
                      "      - uses: actions/upload-artifact@v4\n", "\n  extra:\n    runs-on: ubuntu-latest\n",
                      "\nnew_top_level: 1\n"):
            self.assertTrue(qa.ci_delta_problems(CI_BASE, CI_HEAD + extra), extra)

    def test_candidate_commit_differs_from_the_pin_and_still_qualifies(self):
        self.assertNotEqual(HEAD, qa.PIN)
        self.assertEqual(self.source(), [])

    def test_unchanged_or_unavailable_ci_fails_closed(self):
        self.assertTrue(self.source(head_ci=CI_BASE, head_tree=with_ci(with_qa(good_tree()), CI_BASE)))
        self.assertTrue(self.source(baseline_ci=None))
        self.assertTrue(self.source(head_ci=None))
        self.assertTrue(self.source(baseline_ci="", head_ci=""))

    def test_compared_text_must_be_the_tree_blobs(self):
        self.assertTrue(self.source(head_ci=CI_HEAD + "# x\n"))
        self.assertTrue(self.source(baseline_ci=CI_BASE + "# x\n"))
        self.assertEqual(self.source(pin_tree_oid=OID_A), ["pin does not resolve to the accepted tree"])

    def test_a_consistently_rewritten_baseline_is_refused(self):
        base = CI_BASE.replace("--maxWorkers=2", "--maxWorkers=1")
        head = CI_HEAD.replace("--maxWorkers=2", "--maxWorkers=1")
        self.assertEqual(self.source(pin_tree=with_ci(good_tree(), base), head_tree=with_ci(with_qa(good_tree()), head),
                                     baseline_ci=base, head_ci=head), ["pinned ci.yml is not the accepted baseline"])

    def test_ci_mode_change_is_refused(self):
        head = with_qa(good_tree())
        head[qa.CI_PATH] = ("100755", *head[qa.CI_PATH][1:])
        self.assertEqual(self.source(head_tree=head), [f"changed: {qa.CI_PATH}"])

    def test_no_other_pinned_path_gets_the_ci_exception(self):
        paths = ("app/layout.tsx", "package.json", "package-lock.json", "pnpm-lock.yaml", "vercel.json",
                 "prisma/schema.prisma", "prisma/migrations/1/migration.sql", ".vercelignore",
                 ".github/workflows/other.yml")
        tree = {**good_tree(), **{p: ("100644", "blob", OID_A) for p in paths}}
        for path in paths:
            head = with_qa(tree)
            head[path] = ("100644", "blob", OID_B)
            self.assertEqual(self.source(pin_tree=with_ci(tree), head_tree=head), [f"changed: {path}"])

    def test_exactly_three_helper_files_and_no_standalone_workflow(self):
        self.assertEqual(len(qa.QA_FILES), 3)
        self.assertNotIn(qa.CI_PATH, qa.QA_FILES)
        standalone = ".github/workflows/ot-linux-browser-qa.yml"
        self.assertFalse((ROOT / standalone).exists())
        head = with_qa(good_tree())
        head[standalone] = ("100644", "blob", OID_B)
        self.assertEqual(self.source(head_tree=head), [f"added: {standalone}"])

    def test_fixed_pin_and_tree(self):
        self.assertEqual(qa.PIN, "d2b847e8f0a4a377f2f23a96fb90621c1579d361")
        self.assertEqual(qa.PIN_TREE, "928e0754b7d6fc09c38e9ca9318f974a30f76a9c")

    def test_stage_is_exported_from_the_pin(self):
        text = (HERE / "ot-linux-qa.py").read_text(encoding="utf-8")
        self.assertIn('"--format=tar", "-o", str(archive), PIN]', text)
        self.assertNotIn('str(archive), "HEAD"]', text)

    def test_qa_job_keeps_the_existing_workflow_contracts(self):
        # Mirrors __tests__/ci-workflow-contract.test.ts, which applies to every job.
        block = qa.split_ci(CI_HEAD)[1]
        block = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))
        used = re.findall(r"uses: (\S+)", block)
        self.assertEqual({ref.split("@")[0] for ref in used}, {"actions/checkout", "actions/setup-node"})
        services = (r"\b(psql|pg_dump|pg_restore|mysql|redis-cli|supabase|vercel|netlify|fly|heroku|stripe|resend|"
                    r"sendgrid|aws|gcloud|az|docker|ssh|scp|gh)\s")
        self.assertNotRegex(block, services)
        self.assertNotRegex(block, r"npm (run |test|ci)|enforce-rls|prisma|DATABASE_URL|ot-neutral-p")
        self.assertLess(CI_HEAD.index("\n  recovery-restore-matrix:"), CI_HEAD.index("\n  browser-qa:"))


class Driver(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (HERE / "ot-linux-browser.cjs").read_text()

    def test_keeps_chromium_sandbox(self):
        self.assertIn("chromiumSandbox: true", self.text)
        self.assertNotRegex(self.text, r"--no-sandbox|--disable-(setuid|namespace|seccomp)|ignoreDefaultArgs")

    def test_exact_route_and_links(self):
        self.assertIn("ORIGIN + '/api/free-check'", self.text)
        self.assertIn("method === 'POST' && url === API", self.text)
        self.assertIn("'https://www.cookcountyassessoril.gov/address-search'", self.text)

    def test_case_names_match_orchestrator(self):
        for kind in qa.KINDS:
            self.assertRegex(self.text, rf"(?m)^  '?{kind}'?: \{{")
        for viewport in qa.VIEWPORTS:
            self.assertIn(f"{viewport}: {{ width:", self.text)

    def test_form_values_are_not_read_back(self):
        self.assertNotRegex(self.text, r"inputValue|\.value\b")

    def test_only_invalid_fixtures(self):
        self.assertIn("'100 Synthetic Fixture Way.invalid'", self.text)
        self.assertIn("'Fixtureville.invalid'", self.text)


class BuildFailureExcerpt(unittest.TestCase):
    SECRET = "OUTSIDE_REPORT_NEEDLE"
    FAILED = '{"status": "FAIL", "problems": ["namespace build: synthetic"]}'

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = pathlib.Path(tmp.name, "qa")
        self.report = self.root / "report"
        self.report.mkdir(parents=True)
        self.outside = pathlib.Path(tmp.name, "outside.log")
        self.outside.write_text(self.SECRET)

    def write(self, name, data):
        path = self.report / name
        path.write_bytes(data if isinstance(data, bytes) else data.encode())
        return path

    def failed(self):
        self.write("stage-build.json", self.FAILED)
        self.write("inner-build.json", '{"build": {"exit": 1, "log_bytes": 1197}, "problems": ["build failed"]}')

    def lines(self):
        return qa.build_failure_excerpt(self.report)

    def meta(self, name, lines=None):
        prefix = f"--- build failure {name}: "
        found = [line for line in (lines or self.lines()) if line.startswith(prefix)]
        self.assertEqual(len(found), 1, name)
        return qa.json.loads(found[0][len(prefix):])

    def test_a_1197_byte_log_fits_whole_with_its_labels(self):
        self.failed()
        body = ("Error: synthetic failure line\n" * 60).encode()
        body = (b"FIRST-LINE\n" + body)[:1185] + b"\nFINAL-LINE\n"
        self.assertEqual(len(body), 1197)
        self.write("build.log", body)
        lines = self.lines()
        meta = self.meta("build.log", lines)
        self.assertEqual((meta["bytes"], meta["head_bytes"], meta["tail_bytes"], meta["omitted_bytes"]),
                         (1197, 1197, 0, 0))
        self.assertEqual(meta["sha256"], qa.hashlib.sha256(body).hexdigest())
        self.assertEqual(meta["newlines"], body.count(b"\n"))
        self.assertIs(meta["truncated"], False)
        self.assertIs(meta["output_cut"], False)
        self.assertTrue(meta["sha256_complete"])
        for line in body.decode().rstrip("\n").split("\n"):
            self.assertIn(f"| {line}", lines)

    def test_safe_fixture_errors_are_retained_from_every_file(self):
        self.failed()
        self.write("bwrap-build.log", "bwrap: synthetic setup error\n")
        self.write("build.log", "Error: synthetic generate error\n")
        lines = self.lines()
        for text in ("| bwrap: synthetic setup error", "| Error: synthetic generate error"):
            self.assertIn(text, lines)
        self.assertIn("namespace build: synthetic", "\n".join(lines))
        self.assertIn('"log_bytes": 1197', "\n".join(lines))
        self.assertEqual(self.meta("stage-build.json", lines)["json"], "valid")
        self.assertEqual(self.meta("inner-build.json", lines)["json"], "valid")

    def test_a_large_log_gets_labelled_head_and_tail_windows(self):
        self.failed()
        size = 3 * qa.MIB
        filler = b"y\n" * (size // 2)
        body = b"HEAD-MARK\n" + filler[:size // 2] + b"MIDDLE-MARK\n" + filler[:size // 2] + b"TAIL-MARK\n"
        self.write("build.log", body)
        lines = self.lines()
        text = "\n".join(lines)
        meta = self.meta("build.log", lines)
        self.assertIn("| HEAD-MARK", lines)
        self.assertIn("| TAIL-MARK", lines)
        self.assertNotIn("MIDDLE-MARK", text)
        self.assertIs(meta["truncated"], True)
        self.assertEqual(meta["omitted_bytes"], len(body) - meta["head_bytes"] - meta["tail_bytes"])
        self.assertEqual(meta["tail_offset"], len(body) - meta["tail_bytes"])
        self.assertEqual(meta["sha256"], qa.hashlib.sha256(body).hexdigest())
        self.assertIn(f"--- build failure build.log tail offset={meta['tail_offset']} bytes={meta['tail_bytes']}", lines)

    def test_a_passing_build_keeps_its_logs_out_of_the_job_log(self):
        self.write("stage-build.json", '{"status": "PASS"}')
        self.write("build.log", "NOT-FOR-THE-JOB-LOG")
        self.assertEqual(self.lines(), [])

    def test_a_run_that_never_reached_the_build_prints_nothing(self):
        self.assertEqual(self.lines(), [])

    def test_a_killed_build_with_no_stage_report_is_still_shown(self):
        self.write("build.log", "killed before the stage report\n")
        lines = self.lines()
        self.assertIn("| killed before the stage report", lines)
        self.assertEqual(self.meta("stage-build.json", lines), {"state": "absent"})

    def test_only_the_four_fixed_names_are_read(self):
        self.failed()
        for name in ("server.log", "browser.log", "prepare-npm-ci.log", "bwrap-run.log", "build.log.1", ".env",
                     "stage-prepare.json", "inner.json"):
            self.write(name, "UNNAMED")
        (self.report / "nested").mkdir()
        self.write("nested/build.log", "UNNAMED")
        self.assertNotIn("UNNAMED", "\n".join(self.lines()))
        self.assertEqual(qa.BUILD_EXCERPT_FILES, ("inner-build.json", "stage-build.json", "bwrap-build.log", "build.log"))

    def test_symlinks_are_refused_without_reading_the_target(self):
        self.failed()
        os.symlink(self.outside, self.report / "build.log")
        os.symlink("bwrap-build.log", self.report / "bwrap-build.log")
        lines = self.lines()
        self.assertEqual(self.meta("build.log", lines), {"state": "refused:symlink"})
        self.assertEqual(self.meta("bwrap-build.log", lines), {"state": "refused:symlink"})
        self.assertNotIn(self.SECRET, "\n".join(lines))

    def test_a_host_hardlink_is_refused_and_not_even_hashed(self):
        self.failed()
        os.link(self.outside, self.report / "build.log")
        lines = self.lines()
        self.assertEqual(self.meta("build.log", lines), {"state": "refused:hardlink"})
        self.assertNotIn(self.SECRET, "\n".join(lines))
        self.assertNotIn(qa.hashlib.sha256(self.SECRET.encode()).hexdigest(), "\n".join(lines))

    def test_fifo_and_directory_are_refused_without_blocking(self):
        self.failed()
        os.mkfifo(self.report / "build.log")
        (self.report / "bwrap-build.log").mkdir()
        lines = self.lines()
        self.assertEqual(self.meta("build.log", lines), {"state": "refused:not-regular"})
        self.assertEqual(self.meta("bwrap-build.log", lines), {"state": "refused:not-regular"})

    def test_a_foreign_owner_is_refused(self):
        self.failed()
        self.write("build.log", "FOREIGN")
        real = os.geteuid()
        calls = {"n": 0}

        def euid():
            calls["n"] += 1
            return real if calls["n"] == 1 else real + 1
        with mock.patch.object(qa.os, "geteuid", euid):
            lines = self.lines()
        self.assertEqual(self.meta("build.log", lines), {"state": "refused:owner"})
        self.assertNotIn("FOREIGN", "\n".join(lines))

    def test_report_directory_and_parent_symlinks_are_refused(self):
        real = self.root.parent / "elsewhere" / "report"
        real.mkdir(parents=True)
        (real / "stage-build.json").write_text(self.FAILED)
        (real / "build.log").write_text(self.SECRET)
        link = self.root / "linked-report"
        os.symlink(real, link)
        parent = self.root.parent / "linked-root"
        os.symlink(real.parent, parent)
        for path in (link, parent / "report"):
            lines = qa.build_failure_excerpt(path)
            self.assertEqual(len(lines), 1, path)
            self.assertIn("report directory refused", lines[0])
            self.assertNotIn(self.SECRET, lines[0])

    def test_bad_json_fails_safe_and_keeps_the_raw_window(self):
        deep = "[" * 200_000
        for data, state in (("{not json", "malformed"), ("", "malformed"), (b"\xff\xfe\xff", "malformed"),
                            ('{"status": NaN}', "malformed"), (deep, "too_deep"),
                            ("[" * 100 + "]" * 100, "too_deep"),
                            ('{"status": "PASS", "status": "FAIL"}', "duplicate_key"),
                            ('{"status": "FAIL", "status": "PASS"}', "duplicate_key")):
            self.write("stage-build.json", data)
            self.write("build.log", "kept after bad json\n")
            lines = self.lines()
            self.assertEqual(self.meta("stage-build.json", lines)["json"], state, data[:20])
            self.assertIn("| kept after bad json", lines)
        self.write("stage-build.json", '{"status": "PASS", "status": "PASS"}')
        self.assertIn('status', "\n".join(self.lines()))

    def test_oversize_json_is_not_parsed_and_never_reads_as_pass(self):
        self.write("stage-build.json", '{"status": "PASS", "pad": "' + "x" * 200 + '"}')
        self.write("build.log", "oversize stage\n")
        with mock.patch.object(qa, "BUILD_JSON_PARSE_CAP", 16), \
                mock.patch.object(qa, "classify_build_json", side_effect=AssertionError("parsed")):
            lines = self.lines()
        self.assertEqual(self.meta("stage-build.json", lines)["json"], "oversize")
        self.assertIn("| oversize stage", lines)

    def test_cycle_and_node_bounds(self):
        cycle = []
        cycle.append(cycle)
        with mock.patch.object(qa.json, "loads", return_value=cycle):
            self.assertEqual(qa.classify_build_json(b"[]"), ("too_deep", None))
        with mock.patch.object(qa, "BUILD_JSON_NODES", 3):
            self.assertEqual(qa.classify_build_json(b"[1, 2, 3, 4]"), ("too_deep", None))
        self.assertEqual(qa.classify_build_json(b'{"a": [1]}'), ("valid", {"a": [1]}))

    def test_log_text_cannot_act_as_a_command_or_a_harness_line(self):
        self.failed()
        self.write("build.log", b"::stop-commands::token\n  ::error::spoof\nprefix ##[error]spoof ###[x\n"
                                b"\x1b[2Jclear\rover\x00nul\x7f\n\xff\xfe bytes \xe2\x80\xa8 sep\n"
                                b"--- build failure build.log: {}\n--- RESULT.json\n")
        lines = self.lines()
        self.meta("build.log", lines)
        start = lines.index(next(l for l in lines if l.startswith("--- build failure build.log head")))
        body = lines[start + 1:-1]
        self.assertEqual(len(body), 7)
        for line in lines:
            self.assertTrue(line.isascii(), line)
            self.assertFalse(line.lstrip().startswith("::"), line)
            self.assertNotIn("##[", line)
            self.assertIsNone(re.search(r"[\x00-\x08\x0b-\x1f\x7f]", line), line)
        self.assertTrue(all(line.startswith("| ") for line in body))
        self.assertIn("| --- RESULT.json", body)

    def test_outbound_cap_holds_and_no_file_starves_the_rest(self):
        for name in qa.BUILD_EXCERPT_FILES:
            self.write(name, f"{name}-START\n".encode() + b"\xff" * (3 * qa.MIB))
        lines = self.lines()
        self.assertLessEqual(sum(len(line) + 1 for line in lines), qa.BUILD_EXCERPT_CAP)
        for name in qa.BUILD_EXCERPT_FILES:
            self.assertIn(f"| {name}-START", lines)
            self.assertIs(self.meta(name, lines)["output_cut"], True)
            self.assertIs(self.meta(name, lines)["truncated"], True)
        self.assertRegex(lines[-1], r"^--- build failure excerpt: chars=\d+ cap=131072 cut=false$")

    def test_a_smaller_cap_is_strict_and_says_it_cut(self):
        for name in qa.BUILD_EXCERPT_FILES:
            self.write(name, "z\n" * 5000)
        with mock.patch.object(qa, "BUILD_EXCERPT_CAP", 1024):
            lines = self.lines()
        self.assertLessEqual(sum(len(line) + 1 for line in lines), 1024)
        self.assertRegex(lines[-1], r"cap=1024 cut=true$")

    def test_hash_scope_is_labelled_when_capped(self):
        self.failed()
        self.write("build.log", "abcdef")
        with mock.patch.object(qa, "BUILD_HASH_CAP", 3):
            meta = self.meta("build.log")
        self.assertEqual((meta["sha256_bytes"], meta["sha256_complete"]), (3, False))
        self.assertEqual(meta["sha256"], qa.hashlib.sha256(b"abc").hexdigest())

    def seal(self):
        printed = []
        with mock.patch.object(qa, "print", create=True, side_effect=lambda line, **_kw: printed.append(line)):
            code = qa.seal_body(None, qa.Layout(self.root))
        return code, printed

    def test_seal_prints_the_failed_build_and_keeps_the_verdict_last(self):
        self.failed()
        self.write("build.log", "Error: synthetic generate error\n")
        code, printed = self.seal()
        self.assertEqual(code, 1)
        self.assertIn("| Error: synthetic generate error", printed)
        self.assertEqual(qa.json.loads(printed[-1]), {"status": "FAIL", "dropped": []})
        self.assertLess(printed.index("--- RESULT.json"), printed.index("| Error: synthetic generate error"))
        self.assertEqual(qa.read_json(self.report / "RESULT.json")["problems"], ["run did not complete"])

    def test_seal_of_a_passing_run_is_unchanged(self):
        result = '{"status": "PASS"}'
        self.write("RESULT.json", result)
        self.write("stage-build.json", '{"status": "PASS"}')
        self.write("build.log", "NOT-FOR-THE-JOB-LOG")
        code, printed = self.seal()
        self.assertEqual(code, 0)
        self.assertNotIn("NOT-FOR-THE-JOB-LOG", "\n".join(printed))
        self.assertFalse([line for line in printed if line.startswith("--- build failure")])
        self.assertEqual((self.report / "RESULT.json").read_text(), result)

    def test_seal_survives_an_excerpt_error_without_touching_the_result(self):
        self.failed()
        self.write("RESULT.json", '{"status": "HOLD", "problems": ["held"]}')
        before = (self.report / "RESULT.json").read_bytes()
        for error in (RuntimeError("boom-text"), OSError("boom-text"), RecursionError("boom-text")):
            with mock.patch.object(qa, "build_failure_excerpt", side_effect=error):
                code, printed = self.seal()
            self.assertEqual(code, 1)
            self.assertIn(f"--- build failure excerpt unavailable: {type(error).__name__}", printed)
            self.assertNotIn("boom-text", "\n".join(printed))
            self.assertEqual(qa.json.loads(printed[-1]), {"status": "HOLD", "dropped": []})
            self.assertEqual((self.report / "RESULT.json").read_bytes(), before)

    def test_seal_removes_planted_links_before_any_read(self):
        self.failed()
        os.symlink(self.outside, self.report / "build.log")
        code, printed = self.seal()
        self.assertEqual(code, 1)
        self.assertNotIn(self.SECRET, "\n".join(printed))
        self.assertFalse(os.path.lexists(self.report / "build.log"))
        self.assertEqual(self.meta("build.log", printed), {"state": "absent"})

    def test_seal_refuses_a_planted_hardlink(self):
        self.failed()
        os.link(self.outside, self.report / "build.log")
        code, printed = self.seal()
        self.assertEqual(code, 1)
        self.assertNotIn(self.SECRET, "\n".join(printed))
        self.assertEqual(self.meta("build.log", printed), {"state": "refused:hardlink"})


class PrismaEnginePrepare(unittest.TestCase):
    # @prisma/engines' postinstall is skipped by --ignore-scripts and swallows errors, so
    # this networked step is what fetches schema-engine: the CLI's `generate` entry calls
    # ensureNeededBinariesExist with failSilent false and a checksum-verified download.
    def steps(self):
        return qa.prepare_steps(qa.Layout("/w/_temp/ot-qa"), "/opt/hostedtoolcache/node/24/x64")

    def test_networked_generate_follows_install_and_precedes_the_fence(self):
        labels = [label for label, _argv, _env in self.steps()]
        self.assertLess(labels.index("npm-ci"), labels.index("prisma-generate"))
        argv = dict((label, argv) for label, argv, _env in self.steps())["prisma-generate"]
        self.assertEqual(argv[-2:], ["/w/_temp/ot-qa/app/node_modules/prisma/build/index.js", "generate"])

    def test_no_env_can_weaken_the_engine_download(self):
        for _label, _argv, env in self.steps():
            self.assertFalse([key for key in env if key.startswith(("PRISMA_", "BINARY_DOWNLOAD"))])
        self.assertFalse([key for key in qa.namespace_env("build") if key.startswith("PRISMA_")])


def fake_engine(machine=qa.ELF_X86_64, body=b"schema-engine body"):
    header = b"\x7fELF\x02\x01\x01" + bytes(9) + (3).to_bytes(2, "little") + machine.to_bytes(2, "little")
    return header + body


class PrismaClosureBase(unittest.TestCase):
    """A real on-disk closure, laid out the way the networked prisma-engine-target step leaves it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.layout = qa.Layout(self.tmp.name)
        self.layout.create()
        self.entry = self.layout.prisma_cache
        self.engine_dir = self.layout.app.joinpath(*qa.PRISMA_ENGINE_DIR)
        self.target = self.engine_dir / qa.PRISMA_ENGINE_FILE
        self.entry.mkdir(parents=True)
        self.engine_dir.mkdir(parents=True)
        for package, version in qa.PRISMA_PACKAGES.items():
            folder = self.layout.app / "node_modules" / package
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "package.json").write_text(f'{{"name": "{package}", "version": "{version}"}}')
        self.write_engine(fake_engine())

    def write_engine(self, data):
        for path in (self.entry / "schema-engine", self.target):
            path.write_bytes(data)
            path.chmod(0o755)
        (self.entry / "schema-engine.sha256").write_text(qa.hashlib.sha256(data).hexdigest())
        (self.entry / "schema-engine.gz.sha256").write_text("e" * 64)

    def closure(self):
        return qa.prisma_engine_closure(str(self.layout.cache), str(self.layout.app))

    def assert_refused(self, fragment):
        problems = self.closure()["problems"]
        self.assertTrue([p for p in problems if fragment in p], problems)


class PrismaEngineClosure(PrismaClosureBase):
    def test_entry_matches_the_failed_url_and_the_cache_prisma_derives(self):
        # getCacheDir joins XDG_CACHE_HOME or ~/.cache with prisma/master/<commit>/<target>.
        failed = ("https://binaries.prisma.sh/all_commits/9d6ad21cbbceab97458517b147a6a09ff43aa735/"
                  "debian-openssl-3.0.x/schema-engine.gz.sha256")
        self.assertIn(f"/{qa.PRISMA_ENGINES_COMMIT}/{qa.PRISMA_ENGINE_TARGET}/schema-engine.gz.sha256", failed)
        self.assertEqual(qa.NS_PRISMA_CACHE, f"{qa.namespace_env('build')['XDG_CACHE_HOME']}/{qa.PRISMA_CACHE_REL}")
        self.assertEqual(self.entry, self.layout.home / ".cache/prisma/master" / qa.PRISMA_ENGINES_COMMIT
                         / "debian-openssl-3.0.x")

    def test_packages_match_the_pinned_lock(self):
        lock = (ROOT / "package-lock.json").read_text()
        self.assertEqual(qa.PRISMA_VERSION, "7.3.0")
        for package, version in qa.PRISMA_PACKAGES.items():
            self.assertRegex(lock, rf'"node_modules/{re.escape(package)}": \{{\s+"version": "{re.escape(version)}"')

    def test_verified_closure_reports_exact_provenance(self):
        report = self.closure()
        digest = qa.hashlib.sha256(fake_engine()).hexdigest()
        self.assertEqual(report["problems"], [])
        self.assertEqual((report["sha256"], report["target_sha256"]), (digest, digest))
        self.assertEqual((report["gz_sha256"], report["bytes"]), ("e" * 64, len(fake_engine())))
        self.assertEqual((report["engines_commit"], report["target"]), (qa.PRISMA_ENGINES_COMMIT, qa.PRISMA_ENGINE_TARGET))
        self.assertEqual(report["cached_targets"], ["debian-openssl-3.0.x"])
        self.assertEqual(report["packages"], qa.PRISMA_PACKAGES)

    def test_report_never_holds_a_host_path(self):
        (self.entry / "schema-engine.sha256").unlink()
        self.assertNotIn(self.tmp.name, repr(self.closure()))

    def test_empty_cache_is_refused_like_the_observed_namespace(self):
        for name in qa.PRISMA_CACHE_FILES:
            (self.entry / name).unlink()
        self.assert_refused("cached engine: missing")

    def test_each_missing_cache_file_is_refused(self):
        for name in qa.PRISMA_CACHE_FILES:
            with self.subTest(name):
                saved = (self.entry / name).read_bytes()
                (self.entry / name).unlink()
                self.assert_refused("cached engine: missing")
                (self.entry / name).write_bytes(saved)
                (self.entry / name).chmod(0o755)

    def test_missing_target_is_refused(self):
        self.target.unlink()
        self.assert_refused("target engine: missing")

    def test_malformed_checksums_are_refused(self):
        digest = qa.hashlib.sha256(fake_engine()).hexdigest()
        # Prisma compares with ===, so each of these would otherwise reach the network.
        for label, value in (("newline", digest + "\n"), ("capital", digest.upper()), ("short", digest[:63]),
                             ("empty", ""), ("not hex", "z" * 64), ("long", digest + "0")):
            with self.subTest(label):
                (self.entry / "schema-engine.sha256").write_text(value)
                self.assertTrue(self.closure()["problems"])
        (self.entry / "schema-engine.sha256").write_text(digest)
        (self.entry / "schema-engine.gz.sha256").write_text("not a digest")
        self.assert_refused("malformed checksum")

    def test_checksum_mismatch_is_refused(self):
        (self.entry / "schema-engine.sha256").write_text("0" * 64)
        self.assert_refused("checksum mismatch")

    def test_cached_bytes_changed_after_download_are_refused(self):
        (self.entry / "schema-engine").write_bytes(fake_engine(body=b"tampered"))
        self.assert_refused("checksum mismatch")

    def test_target_differing_from_cache_is_refused(self):
        self.target.write_bytes(fake_engine(body=b"other"))
        self.assert_refused("differs from the cached engine")

    def test_package_version_mismatch_is_refused(self):
        for package in qa.PRISMA_PACKAGES:
            with self.subTest(package):
                path = self.layout.app / "node_modules" / package / "package.json"
                saved = path.read_text()
                path.write_text('{"version": "7.7.0"}')
                self.assert_refused(f"{package}: version mismatch")
                path.write_text(saved)

    def test_malformed_or_missing_package_json_is_refused(self):
        path = self.layout.app / "node_modules/@prisma/engines-version/package.json"
        for label, value in (("bad", "{"), ("array", "[]"), ("dup", '{"version": "1", "version": "2"}'),
                             ("no version", "{}"), ("numeric", '{"version": 7}')):
            with self.subTest(label):
                path.write_text(value)
                self.assert_refused("malformed package.json")
        path.unlink()
        self.assert_refused("@prisma/engines-version: missing")

    def test_a_different_detected_target_is_refused_and_named(self):
        self.entry.rename(self.entry.with_name("rhel-openssl-3.0.x"))
        report = self.closure()
        self.assertIn("cached engine: missing", report["problems"])
        self.assertEqual(report["cached_targets"], ["rhel-openssl-3.0.x"])

    def test_a_different_engine_version_directory_is_refused(self):
        self.entry.parent.rename(self.entry.parent.with_name("0" * 40))
        self.assert_refused("cached engine: missing")

    def test_foreign_abi_and_non_elf_are_refused(self):
        for label, data, fragment in (("aarch64", fake_engine(machine=183), "x86-64"),
                                      ("script", b"#!/bin/sh\nexit 0\n" + bytes(8), "not an ELF"),
                                      ("truncated", b"\x7fELF", "not an ELF"),
                                      ("32-bit", b"\x7fELF\x01" + fake_engine()[5:], "64-bit")):
            with self.subTest(label):
                self.write_engine(data)
                self.assert_refused(fragment)

    def test_empty_and_oversize_engines_are_refused(self):
        self.write_engine(b"")
        self.assert_refused("size out of bounds")
        self.write_engine(fake_engine())
        with mock.patch.object(qa, "PRISMA_ENGINE_CAP", 8):
            self.assert_refused("size out of bounds")

    def test_non_executable_engine_is_refused(self):
        self.target.chmod(0o644)
        self.assert_refused("target engine: not executable")

    def test_unsafe_modes_are_refused(self):
        for mode in (0o757, 0o4755, 0o2755):
            with self.subTest(oct(mode)):
                self.target.chmod(mode)
                # chmod silently drops setgid when the file's group is not one of the caller's.
                if self.target.stat().st_mode & 0o7777 == mode:
                    self.assert_refused("target engine: refused")
        self.target.chmod(0o755)
        self.entry.chmod(0o777)
        self.assert_refused("cached engine: refused")
        self.entry.chmod(0o755)

    def test_foreign_owner_is_refused(self):
        with mock.patch.object(qa.os, "geteuid", return_value=os.geteuid() + 1):
            self.assert_refused("cached engine: refused")

    def test_symlinked_files_are_refused(self):
        outside = self.layout.outside / "engine"
        outside.write_bytes(fake_engine())
        outside.chmod(0o755)
        for path in (self.entry / "schema-engine", self.target):
            with self.subTest(path.name):
                path.unlink()
                path.symlink_to(outside)
                self.assertTrue(self.closure()["problems"])
                path.unlink()
                path.write_bytes(fake_engine())
                path.chmod(0o755)

    def test_symlinked_directories_are_refused(self):
        moved = self.layout.outside / "entry"
        self.entry.rename(moved)
        self.entry.symlink_to(moved)
        self.assert_refused("cached engine: refused")

    def test_symlinked_cache_root_is_refused(self):
        moved = self.layout.outside / "cache"
        self.layout.cache.rename(moved)
        self.layout.cache.symlink_to(moved)
        self.assert_refused("cached engine: refused")

    def test_hardlink_fifo_and_directory_are_refused(self):
        os.link(self.entry / "schema-engine", self.layout.outside / "linked")
        self.assert_refused("not a single regular file")
        (self.layout.outside / "linked").unlink()
        self.target.unlink()
        os.mkfifo(self.target)
        self.assert_refused("target engine: not a single regular file")
        self.target.unlink()
        self.target.mkdir()
        self.assert_refused("target engine: not a single regular file")

    def test_unexpected_cache_entry_is_refused(self):
        (self.entry / "private").write_text("x")
        self.assert_refused("unexpected cache entries")

    def test_read_only_closure_stays_usable(self):
        self.entry.chmod(0o555)
        self.addCleanup(self.entry.chmod, 0o755)
        self.assertEqual(self.closure()["problems"], [])

    def test_engine_version_uses_prismas_substring_rule(self):
        ok = {"exit": 0, "reason": None}
        self.assertEqual(qa.engine_version_problems(ok, f"schema-engine-cli {qa.PRISMA_ENGINES_COMMIT}\n"), [])
        self.assertEqual(qa.engine_version_problems(ok, "schema-engine-cli " + "0" * 40), ["schema-engine version mismatch"])
        self.assertEqual(qa.engine_version_problems({"exit": 127, "reason": None}, qa.PRISMA_ENGINES_COMMIT),
                         ["schema-engine --version failed"])
        self.assertEqual(qa.engine_version_problems({"exit": None, "reason": "ENOENT"}, ""),
                         ["schema-engine --version failed"])

    def test_namespace_check_needs_the_same_digest_and_a_read_only_mount(self):
        report = self.closure()
        self.assertEqual(qa.namespace_engine_problems(report, report["sha256"], "EROFS"), [])
        self.assertTrue(qa.namespace_engine_problems(report, "0" * 64, "EROFS"))
        self.assertTrue(qa.namespace_engine_problems(report, report["sha256"], None))
        self.assertTrue(qa.namespace_engine_problems(report, report["sha256"], "EACCES"))
        self.assertTrue(qa.namespace_engine_problems({**report, "problems": ["x"]}, report["sha256"], "EROFS"))


class PrismaCacheBind(unittest.TestCase):
    NODE = "/opt/hostedtoolcache/node/24.0.0/x64"

    def setUp(self):
        self.layout = qa.Layout("/w/_temp/ot-qa")
        self.source = str(self.layout.prisma_cache)

    def argv(self, mode="build"):
        return qa.build_bwrap_argv(self.layout, self.NODE, mode, ["/usr/bin/python3", "x"], 9)

    def problems(self, argv, mode="build"):
        return qa.bwrap_problems(argv, self.layout, self.NODE, mode)

    def binds(self, argv):
        return [argv[i:i + 3] for i, arg in enumerate(argv) if arg in ("--ro-bind", "--bind")]

    def in_cache_dir(self, path):
        # A whole path component, so the public /etc/ld.so.cache file never matches.
        return ".cache" in pathlib.PurePosixPath(path).parts

    def test_build_binds_only_the_exact_entry_read_only_after_tmp(self):
        argv = self.argv()
        self.assertEqual(self.problems(argv), [])
        at = argv.index(self.source)
        self.assertEqual(argv[at - 1:at + 2], ["--ro-bind", self.source, qa.NS_PRISMA_CACHE])
        self.assertLess(argv.index("/tmp"), at)

    def test_build_mounts_differ_from_runtime_by_this_contract_only(self):
        build = self.binds(self.argv("build"))
        runtime = self.binds(self.argv("runtime"))
        self.assertEqual([b for b in build if b[2] == qa.NS_PRISMA_CACHE], [["--ro-bind", self.source, qa.NS_PRISMA_CACHE]])
        self.assertFalse([b for b in runtime if "prisma" in b[1] or self.in_cache_dir(b[1])])
        self.assertEqual([b for b in build if self.in_cache_dir(b[1]) or "/etc/os-release" in b[2]],
                         [["--ro-bind", self.source, qa.NS_PRISMA_CACHE]])

    def test_argv_adds_no_engine_env_or_network_flag(self):
        argv = self.argv()
        names = [argv[i + 1] for i, arg in enumerate(argv) if arg == "--setenv"]
        self.assertFalse([n for n in names if n.startswith(("PRISMA_", "BINARY_DOWNLOAD"))])
        self.assertNotIn("--share-net", argv)
        self.assertIn("--unshare-all", argv)

    def test_missing_or_repeated_bind_is_refused(self):
        argv = self.argv()
        at = argv.index(self.source) - 1
        self.assertTrue(self.problems(argv[:at] + argv[at + 3:]))
        self.assertTrue(self.problems(argv[:at] + argv[at:at + 3] + argv[at:]))

    def test_bind_before_or_under_a_later_tmp_mount_is_refused(self):
        argv = self.argv()
        at = argv.index(self.source) - 1
        tmp = argv.index("/tmp") - 2
        self.assertTrue(self.problems(argv[:tmp] + argv[at:at + 3] + argv[tmp:at] + argv[at + 3:]))
        self.assertTrue(self.problems(argv[:at + 3] + ["--bind", str(self.layout.tmp_build), "/tmp"] + argv[at + 3:]))

    def test_inexact_or_writable_binds_are_refused(self):
        insert = {
            "whole cache": ["--ro-bind", str(self.layout.cache), "/tmp/cache"],
            "whole home": ["--ro-bind", str(self.layout.home), "/tmp/home"],
            "parent entry": ["--ro-bind", str(self.layout.prisma_cache.parent), qa.NS_PRISMA_CACHE],
            "other destination": ["--ro-bind", self.source, "/tmp/elsewhere"],
            "other source": ["--ro-bind", "/usr", qa.NS_PRISMA_CACHE],
            "writable": ["--bind", self.source, qa.NS_PRISMA_CACHE],
            "whole etc": ["--ro-bind", "/etc", "/etc"],
            "os release": ["--ro-bind", "/etc/os-release", "/etc/os-release"],
        }
        for label, extra in insert.items():
            with self.subTest(label):
                argv = self.argv()
                argv[1:1] = extra
                self.assertTrue(self.problems(argv))

    def test_runtime_cannot_gain_the_build_entry(self):
        argv = self.argv("runtime")
        self.assertEqual(self.problems(argv, "runtime"), [])
        argv[1:1] = ["--ro-bind", self.source, qa.NS_PRISMA_CACHE]
        self.assertTrue(self.problems(argv, "runtime"))


class PrismaEngineStages(PrismaClosureBase):
    def setUp(self):
        super().setUp()
        self.args = mock.Mock(node="/opt/hostedtoolcache/node/24/x64/bin/node", timeout=315,
                              engine_sha256=qa.hashlib.sha256(fake_engine()).hexdigest())
        qa.write_json(self.layout.report / "stage-validate.json", {"status": "PASS"})

    def fake_run(self, stdout=f"schema-engine-cli {qa.PRISMA_ENGINES_COMMIT}\n", exit_code=0):
        def run(argv, log_path, *_args, **_kwargs):
            pathlib.Path(log_path).write_text(stdout)
            return {"exit": exit_code, "reason": None}
        return mock.patch.object(qa, "run_bounded", side_effect=run)

    def prepare(self):
        with mock.patch.object(qa, "prepare_steps", return_value=[]), \
                mock.patch.object(qa, "preflight_problems", return_value=[]), \
                mock.patch.object(qa, "find_chrome", return_value=str(self.layout.browsers / "chrome")):
            return qa.prepare_body(self.args, self.layout)

    def build(self, recorded):
        qa.write_json(self.layout.report / "stage-prepare.json", {"status": "PASS", "node_root": "/n",
                                                                  "prisma_engine": recorded})
        qa.write_json(self.layout.work / "expected-tree.json", {"a": ["100644", "blob", "x"]})
        (self.layout.app / "scripts").mkdir()
        (self.layout.app / qa.BUILD_WRAPPER).write_text("")
        qa.write_json(self.layout.report / "inner-build.json", {"problems": [], "offbox": []})
        with mock.patch.object(qa, "wrapper_problems", return_value=[]), \
                mock.patch.object(qa, "preflight_problems", return_value=[]), \
                mock.patch.object(qa, "stage_tree_problems", return_value=[]), \
                mock.patch.object(qa, "build_output_problems", return_value=[]), \
                mock.patch.object(qa, "run_in_namespace", return_value={"exit": 0, "reason": None}) as ns:
            try:
                return qa.build_body(self.args, self.layout), ns
            except qa.StageStop as stop:
                return stop, ns

    def inner(self, closure, write_errno="EROFS"):
        written = {}
        ran = []
        def run(argv, log_path, *_args, **_kwargs):
            ran.append(argv)
            return {"exit": 0, "reason": None}
        version = ({"exit": 0, "reason": None}, qa.PRISMA_ENGINES_COMMIT)
        with mock.patch.object(qa.os, "makedirs"), mock.patch.object(qa, "offbox_probes", return_value=[]), \
                mock.patch.object(qa, "evaluate_offbox", return_value=[]), \
                mock.patch.object(qa, "proc_env_keys", return_value=[]), \
                mock.patch.object(qa, "prisma_engine_closure", return_value=closure), \
                mock.patch.object(qa, "probe_readonly", return_value=write_errno), \
                mock.patch.object(qa, "probe_engine_version", return_value=version), \
                mock.patch.object(qa, "run_bounded", side_effect=run), \
                mock.patch.object(qa, "write_json", side_effect=lambda _p, ev: written.update(ev)), \
                mock.patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=True):
            code = qa.inner_build(self.args)
        return code, written, ran

    def test_prepare_records_the_verified_closure(self):
        with self.fake_run() as run:
            result = self.prepare()
        self.assertEqual(result["prisma_engine"]["sha256"], self.args.engine_sha256)
        self.assertEqual(run.call_args.args[0], [str(self.target), "--version"])

    def test_prepare_refuses_a_missing_cache_before_running_the_engine(self):
        (self.entry / "schema-engine.sha256").unlink()
        with self.fake_run() as run, self.assertRaises(qa.StageStop) as stop:
            self.prepare()
        self.assertEqual(stop.exception.status, "FAIL")
        self.assertIn("prisma engine closure: cached engine: missing", stop.exception.problems)
        run.assert_not_called()

    def test_prepare_refuses_a_wrong_or_failing_engine_version(self):
        for stdout, code, message in (("schema-engine-cli " + "0" * 40, 0, "schema-engine version mismatch"),
                                      ("", 127, "schema-engine --version failed")):
            with self.subTest(message), self.fake_run(stdout, code), self.assertRaises(qa.StageStop) as stop:
                self.prepare()
            self.assertEqual(stop.exception.problems, [message])

    def test_unstartable_engine_is_a_reported_failure(self):
        with mock.patch.object(qa, "run_bounded", side_effect=FileNotFoundError(qa.errno.ENOENT, "x")):
            result, text = qa.probe_engine_version("/x", self.layout.work / "log", {}, None)
        self.assertEqual((result["exit"], result["reason"], text), (None, "ENOENT", ""))
        self.assertTrue(qa.engine_version_problems(result, text))

    def test_build_passes_the_verified_digest_into_the_namespace(self):
        result, ns = self.build(self.closure())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["prisma_engine"]["sha256"], self.args.engine_sha256)
        inner = ns.call_args.args[3]
        self.assertEqual(inner[inner.index("--engine-sha256") + 1], self.args.engine_sha256)

    def test_build_refuses_drift_since_prepare_before_the_namespace(self):
        recorded = self.closure()
        self.write_engine(fake_engine(body=b"replaced"))
        stop, ns = self.build(recorded)
        self.assertEqual(stop.problems, ["prisma engine closure changed since prepare"])
        ns.assert_not_called()

    def test_build_refuses_a_broken_cache_before_the_namespace(self):
        recorded = self.closure()
        (self.entry / "schema-engine.gz.sha256").unlink()
        stop, ns = self.build(recorded)
        self.assertIn("prisma engine closure: cached engine: missing", stop.problems)
        ns.assert_not_called()

    def test_inner_builds_with_a_verified_read_only_entry(self):
        code, written, ran = self.inner(self.closure())
        self.assertEqual(code, 0)
        self.assertEqual(ran, [[qa.NS_NODE_BIN, qa.BUILD_WRAPPER]])
        self.assertEqual(written["prisma_engine"]["sha256"], self.args.engine_sha256)
        self.assertEqual(written["engine_version_probe"]["problems"], [])

    def test_inner_never_starts_the_wrapper_on_a_bad_entry(self):
        good = self.closure()
        for label, closure, write_errno in (("writable", good, None),
                                            ("other digest", {**good, "sha256": "0" * 64}, "EROFS"),
                                            ("broken", {**good, "problems": ["cached engine: missing"]}, "EROFS")):
            with self.subTest(label):
                code, written, ran = self.inner(closure, write_errno)
                self.assertEqual((code, ran, written["build"]), (3, [], "notrun"))
                self.assertTrue(written["problems"])

    def test_inner_build_requires_the_expected_digest(self):
        parsed = qa.parse_args(["inner-build", "--timeout", "1", "--engine-sha256", "a" * 64])
        self.assertEqual(parsed.engine_sha256, "a" * 64)
        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            qa.parse_args(["inner-build", "--timeout", "1"])


class PrismaEngineTargetFetch(PrismaClosureBase):
    """The real prepare_steps through the real prepare_body; only the child processes are fake."""

    NODE_ROOT = "/opt/hostedtoolcache/node/24/x64"
    HOST_TARGET = "host-detected-target"

    def setUp(self):
        super().setUp()
        for path in [*self.entry.iterdir(), self.target]:
            path.unlink()
        self.entry.rmdir()
        qa.write_json(self.layout.report / "stage-validate.json", {"status": "PASS"})
        self.args = mock.Mock(node=f"{self.NODE_ROOT}/bin/node")
        self.argv, self.ran, self.printed = {}, [], []
        self.exits, self.outputs, self.effects = {}, {}, {}

    def materialize(self, data=None):
        self.entry.mkdir(parents=True, exist_ok=True)
        self.write_engine(data or fake_engine())

    def host_engine(self):
        entry = self.entry.parent / self.HOST_TARGET
        entry.mkdir()
        (entry / "schema-engine").write_bytes(fake_engine(body=b"host"))
        host = self.engine_dir / f"schema-engine-{self.HOST_TARGET}"
        host.write_bytes(fake_engine(body=b"host"))
        host.chmod(0o755)

    def run_child(self, argv, log_path, *_args, **_kwargs):
        label = pathlib.Path(log_path).name[len("prepare-"):-len(".log")]
        self.ran.append(label)
        self.argv[label] = argv
        pathlib.Path(log_path).write_text(self.outputs.get(label, f"schema-engine-cli {qa.PRISMA_ENGINES_COMMIT}\n"))
        self.effects.get(label, lambda: None)()
        return {"exit": self.exits.get(label, 0), "reason": None}

    def prepare(self):
        with mock.patch.object(qa, "run_bounded", side_effect=self.run_child), \
                mock.patch.object(qa, "preflight_problems", return_value=[]), \
                mock.patch.object(qa, "find_chrome", return_value=str(self.layout.browsers / "chrome")), \
                mock.patch.object(qa, "print", create=True, side_effect=lambda line, **_kw: self.printed.append(line)):
            return qa.prepare_body(self.args, self.layout)

    def prepare_stop(self):
        with self.assertRaises(qa.StageStop) as stop:
            self.prepare()
        self.assertEqual(stop.exception.status, "FAIL")
        return stop.exception.problems

    def steps(self):
        return {label: (argv, env) for label, argv, env in qa.prepare_steps(self.layout, self.NODE_ROOT)}

    def test_fetch_passes_the_exact_public_module_target_and_commit(self):
        app = self.layout.app
        self.assertEqual(self.steps()["prisma-engine-target"][0], [
            f"{self.NODE_ROOT}/bin/node", "-e", qa.PRISMA_TARGET_FETCH,
            f"{app}/node_modules/@prisma/fetch-engine", f"{app}/node_modules/@prisma/engines",
            "debian-openssl-3.0.x", "9d6ad21cbbceab97458517b147a6a09ff43aa735",
        ])

    def test_fetch_awaits_a_strict_download_and_starts_failed(self):
        script = qa.PRISMA_TARGET_FETCH
        options = re.search(r"await download\(\{(.*?)\}\);", script, re.S).group(1)
        names = re.findall(r"^\s*\[?([A-Za-z]+)\b", options, re.M)
        self.assertEqual(names, ["binaries", "binaryTargets", "version", "failSilent"])
        self.assertIn("[BinaryType.SchemaEngineBinary]: engineDir", options)
        self.assertIn("binaryTargets: [target]", options)
        self.assertIn("failSilent: false", options)
        self.assertLess(script.index("process.exitCode = 1"), script.index("await download"))
        self.assertLess(script.index("await download"), script.index("process.exitCode = 0"))

    def test_fetch_cannot_reach_an_integrity_or_source_override(self):
        script = qa.PRISMA_TARGET_FETCH.lower()
        for word in ("skipcacheintegritycheck", "process.env", "prisma_", "mirror", "checksum", "force", "http"):
            self.assertNotIn(word, script)
        self.assertEqual(qa.PRISMA_TARGET_FETCH.count("process.argv"), 1)

    def test_fetch_follows_install_and_precedes_generate(self):
        self.assertEqual(list(self.steps()), ["apt-update", "apt-bubblewrap", "npm-ci", "prisma-engine-target",
                                              "prisma-generate", "playwright-deps", "playwright-chromium"])

    def test_fetch_shares_generates_env_so_the_cache_lands_where_it_is_bound(self):
        steps = self.steps()
        env = steps["prisma-engine-target"][1]
        self.assertEqual(env, steps["prisma-generate"][1])
        # No XDG_CACHE_HOME: getRootCacheDir falls to os.homedir()/.cache/prisma.
        self.assertEqual(pathlib.Path(env["HOME"]) / ".cache", self.layout.cache)
        self.assertNotIn("XDG_CACHE_HOME", env)

    def test_explicit_target_survives_generate_fetching_another_host_target(self):
        self.effects = {"prisma-engine-target": self.materialize, "prisma-generate": self.host_engine}
        result = self.prepare()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["prisma_engine"]["target"], "debian-openssl-3.0.x")
        self.assertEqual(result["prisma_engine"]["problems"], [])
        self.assertEqual(result["prisma_engine"]["cached_targets"], sorted([qa.PRISMA_ENGINE_TARGET, self.HOST_TARGET]))
        self.assertEqual(result["prisma_engine"]["installed_targets"], result["prisma_engine"]["cached_targets"])
        self.assertLess(self.ran.index("prisma-engine-target"), self.ran.index("prisma-generate"))
        self.assertEqual(self.argv["prisma-engine-version"], [str(self.target), "--version"])

    def test_explicit_target_passes_when_generate_adds_nothing(self):
        self.effects = {"prisma-engine-target": self.materialize}
        self.assertEqual(self.prepare()["prisma_engine"]["installed_targets"], [qa.PRISMA_ENGINE_TARGET])

    def test_inventory_reaches_the_ci_log_on_success(self):
        self.effects = {"prisma-engine-target": self.materialize, "prisma-generate": self.host_engine}
        self.prepare()
        self.assertIn(f"cached={sorted([qa.PRISMA_ENGINE_TARGET, self.HOST_TARGET])}", self.printed[0])
        self.assertTrue(self.printed[1].startswith("prisma engine version probe: exit=0 reason=None"))

    def test_a_host_only_engine_reproduces_the_observed_failure_and_names_the_target(self):
        # Exit 0 with nothing written. Run 42193443324 reported only the two missing lines;
        # its host target is unknown, so HOST_TARGET and this inventory are synthetic.
        self.effects = {"prisma-generate": self.host_engine}
        problems = self.prepare_stop()
        self.assertEqual(problems[:2], ["prisma engine closure: cached engine: missing",
                                        "prisma engine closure: target engine: missing"])
        self.assertEqual(problems[2], f"prisma engine inventory: cached=['{self.HOST_TARGET}'] "
                                      f"installed=['{self.HOST_TARGET}']")
        self.assertNotIn(self.tmp.name, "\n".join(problems))
        self.assertNotIn("prisma-engine-version", self.ran)

    def test_a_failed_fetch_stops_before_generate_and_the_browser(self):
        self.exits = {"prisma-engine-target": 1}
        problems = self.prepare_stop()
        self.assertTrue(problems[0].startswith("prepare prisma-engine-target: "))
        self.assertEqual(self.ran[-2:], ["npm-ci", "prisma-engine-target"])

    def fail_fetch(self, output=None):
        self.exits = {"prisma-engine-target": 1}
        if output is not None:
            self.outputs = {"prisma-engine-target": output}
        problems = self.prepare_stop()
        self.assertEqual(len(problems), 1)
        self.assertTrue(problems[0].startswith("prepare prisma-engine-target: {'exit': 1"), problems)
        self.assertEqual(self.ran[-1], "prisma-engine-target")

    def test_a_failed_fetch_prints_its_first_error_without_the_root(self):
        self.fail_fetch(f"Error: Failed to fetch the engine\n    at download ({self.layout.app}/x.js:1:2)\n")
        self.assertEqual(self.printed, [
            f"--- {qa.PRISMA_TARGET_LOG}: bytes={(self.layout.report / qa.PRISMA_TARGET_LOG).stat().st_size} cut=false",
            "| Error: Failed to fetch the engine",
            "|     at download (<root>/app/x.js:1:2)",
        ])

    def test_the_excerpt_reads_the_log_the_real_step_writes(self):
        self.assertEqual(qa.PRISMA_TARGET_LOG, "prepare-prisma-engine-target.log")
        self.fail_fetch("Error: named\n")
        self.assertTrue((self.layout.report / qa.PRISMA_TARGET_LOG).is_file())
        self.assertIn("| Error: named", self.printed)

    def test_fetch_log_text_cannot_act_as_a_runner_command(self):
        self.fail_fetch("::error::a\n##[error]b\n\x1b[31mc\rd\n")
        self.assertEqual(self.printed[1:], ["| ::error::a", "| #\\x23[error]b", "| \\x1b[31mc\\x0dd"])

    def test_only_a_failed_fetch_prints_a_step_log(self):
        self.outputs = {"prisma-engine-target": "fetch marker\n", "prisma-generate": "generate marker\n"}
        self.exits = {"prisma-generate": 1}
        self.effects = {"prisma-engine-target": self.materialize}
        self.assertTrue(self.prepare_stop()[0].startswith("prepare prisma-generate: "))
        self.assertEqual(self.printed, [])
        self.exits = {}
        self.assertEqual(self.prepare()["status"], "PASS")
        self.assertNotIn("marker", "\n".join(self.printed))

    def test_the_excerpt_keeps_the_first_and_last_lines_under_its_cap(self):
        log = self.layout.report / qa.PRISMA_TARGET_LOG
        log.write_bytes(b"Error: first\n" + b"\xff##[x\n" * 200_000 + b"\xff" * 9000 + b"\nError: last\n")
        lines = qa.prisma_target_excerpt(self.layout.report, self.layout.root)
        self.assertLessEqual(sum(len(line) + 1 for line in lines), qa.PRISMA_TARGET_EXCERPT_CAP)
        self.assertEqual(lines[0], f"--- {qa.PRISMA_TARGET_LOG}: bytes={log.stat().st_size} cut=true")
        self.assertEqual(lines[1], "| Error: first")
        self.assertEqual(lines[-1], "| Error: last")
        self.assertNotIn("##[", "\n".join(lines))
        self.assertTrue(all(line.startswith(("--- ", "| ")) for line in lines))

    def test_an_unsafe_fetch_log_is_refused_unread(self):
        log = self.layout.report / qa.PRISMA_TARGET_LOG
        outside = self.layout.outside / "secret"
        outside.write_text("outside marker\n")
        for state, make in (("refused:symlink", lambda: log.symlink_to(outside)),
                            ("refused:hardlink", lambda: os.link(outside, log)),
                            ("refused:not-regular", lambda: os.mkfifo(log)),
                            ("absent", lambda: None)):
            log.unlink(missing_ok=True)
            self.printed = []
            self.effects = {"prisma-engine-target": lambda: (log.unlink(), make())}
            with self.subTest(state):
                self.fail_fetch()
                self.assertEqual(self.printed, [f'--- {qa.PRISMA_TARGET_LOG}: {{"state": "{state}"}}'])

    def test_a_broken_excerpt_cannot_replace_the_fetch_failure(self):
        with mock.patch.object(qa, "prisma_target_excerpt", side_effect=RuntimeError("log text")):
            self.fail_fetch()
        self.assertEqual(self.printed, [f"--- {qa.PRISMA_TARGET_LOG} excerpt unavailable: RuntimeError"])

    def test_a_closed_stdout_cannot_replace_the_fetch_failure(self):
        self.printed = mock.Mock()
        self.printed.append.side_effect = BrokenPipeError
        self.fail_fetch("Error: unseen\n")
        self.printed.append.assert_called_once()

    def test_a_fetch_without_the_checksum_files_is_refused(self):
        def partial():
            self.materialize()
            (self.entry / "schema-engine.gz.sha256").unlink()
        self.effects = {"prisma-engine-target": partial}
        self.assertIn("prisma engine closure: cached engine: missing", self.prepare_stop())
        self.assertNotIn("prisma-engine-version", self.ran)

    def test_a_fetched_engine_of_another_architecture_is_refused_before_running(self):
        self.effects = {"prisma-engine-target": lambda: self.materialize(fake_engine(machine=183))}
        problems = self.prepare_stop()
        self.assertIn("prisma engine closure: cached engine: not an x86-64 executable", problems)
        self.assertNotIn("prisma-engine-version", self.ran)

    def test_a_target_the_host_cannot_load_fails_with_a_pathless_reason_and_no_fallback(self):
        self.effects = {"prisma-engine-target": self.materialize, "prisma-generate": self.host_engine}
        self.exits = {"prisma-engine-version": 127}
        self.outputs = {"prisma-engine-version": f"{self.target}: error while loading shared libraries: libssl.so.3\n"}
        self.assertEqual(self.prepare_stop(), ["schema-engine --version failed"])
        self.assertEqual(self.ran.count("prisma-engine-version"), 1)
        self.assertEqual(self.argv["prisma-engine-version"], [str(self.target), "--version"])
        evidence = self.printed[-1]
        self.assertIn("exit=127", evidence)
        self.assertIn("libssl.so.3", evidence)
        self.assertNotIn(self.tmp.name, evidence)

    def test_version_evidence_is_one_bounded_line(self):
        line = qa.engine_version_evidence({"exit": 1}, "x\n::error::y " * 100, "/root")
        self.assertNotIn("\n", line)
        self.assertLess(len(line), 400)
        self.assertTrue(line.startswith("prisma engine version probe: "))

    def test_version_evidence_neutralises_the_runner_command_marker(self):
        line = qa.engine_version_evidence({"exit": 1}, "##[error]y", "/root")
        self.assertIn("#\\\\x23[error]y", line)
        # Around the 240-character cut too: truncation must not restore the marker.
        for pad in range(236, 242):
            line = qa.engine_version_evidence({"exit": 1}, "x" * pad + "##[error]y ##\n[", "/root")
            self.assertNotIn("##[", line)
            self.assertLess(len(line), 400)

    def test_installed_targets_are_names_only(self):
        for name in (self.HOST_TARGET, "BAD NAME"):
            (self.engine_dir / f"schema-engine-{name}").write_bytes(b"x")
        (self.engine_dir / "index.js").write_text("")
        self.assertEqual(self.closure()["installed_targets"], [self.HOST_TARGET])

    def test_installed_targets_of_an_absent_package_are_empty(self):
        report = qa.prisma_engine_closure(str(self.layout.cache), str(self.layout.outside))
        self.assertEqual(report["installed_targets"], [])


if __name__ == "__main__":
    unittest.main()
