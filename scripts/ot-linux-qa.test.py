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


if __name__ == "__main__":
    unittest.main()
