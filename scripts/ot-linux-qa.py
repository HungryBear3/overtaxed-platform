#!/usr/bin/env python3
"""Linux browser QA harness for /check. Driven by the browser-qa job in ci.yml.

Stages: validate -> prepare (only networked stage) -> build -> run -> seal.
`build` and `run` re-enter this file inside bubblewrap as inner-build/inner-run.
Pure evaluators are separated from process work so ot-linux-qa.test.py can cover
them without starting a browser, a sandbox, a socket or a build.

This is synthetic client QA, not backend qualification. Python 3.10+, stdlib only.
"""
import argparse
import copy
import errno
import glob
import hashlib
import http.client
import http.server
import json
import os
import pathlib
import re
import resource
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import threading
import time

PIN = "d2b847e8f0a4a377f2f23a96fb90621c1579d361"
PIN_TREE = "928e0754b7d6fc09c38e9ca9318f974a30f76a9c"
BRANCH_REF = "refs/heads/abigail/ot-503-canonical-20261106"
QA_FILES = frozenset({
    "scripts/ot-linux-qa.py",
    "scripts/ot-linux-browser.cjs",
    "scripts/ot-linux-qa.test.py",
})
HARNESS_FILES = ("scripts/ot-linux-qa.py", "scripts/ot-linux-browser.cjs")

# ci.yml is the one pinned path HEAD may change, and only by these additions.
CI_PATH = ".github/workflows/ci.yml"
CI_BASELINE_SHA256 = "aaeb72867880e68320ac0594233eb8169df3b447a6e5c33c26a842e8cf6e239c"
CI_GUARDED_JOB_NAMES = (
    "    name: build · type-check · test\n",
    "    name: synthetic fixture portability · PostgreSQL ${{ matrix.postgres }}\n",
)
CI_SKIP_GUARD = f"    if: github.event_name != 'workflow_dispatch' || github.ref != '{BRANCH_REF}'\n"
CI_RUN_GUARD = f"    if: github.event_name == 'workflow_dispatch' && github.ref == '{BRANCH_REF}'\n"
CI_QA_MARKER = "\n  # Synthetic /check browser QA"
CI_QA_ACTIONS = (
    "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
)
CI_QA_FORBIDDEN = (
    "secrets.", "id-token", "environment:", "GITHUB_TOKEN", "github.token", "pull_request_target",
    "privileged", "cap-add", "unconfined", "--network", "container:", "sysctl", "sudo", "--no-sandbox",
    "services:", "needs:", "permissions:", "npm ", "prisma", "psql", "postgresql", "upload-artifact",
)
BUILD_WRAPPER = "scripts/build-with-migrate-retry.mjs"
WRAPPER_COMMANDS = ["prisma generate", "next build"]

BWRAP = "/usr/bin/bwrap"
SELF_PYTHON = "/usr/bin/python3"
NS_APP = "/qa/app"
NS_HARNESS = "/qa/harness"
NS_BROWSERS = "/qa/browsers"
NS_OUT = "/qa/out"
NS_NODE = "/opt/node"
NS_NODE_BIN = NS_NODE + "/bin/node"
PORT = 31863

SYNTHETIC_DSN = "postgresql://invalid:invalid@127.0.0.1:9/invalid"
# Public anycast literals: no DNS needed, and the fence must stop them in the kernel.
OFFBOX_TARGETS = (
    ("tcp4", socket.AF_INET, socket.SOCK_STREAM, ("1.1.1.1", 443)),
    ("tcp6", socket.AF_INET6, socket.SOCK_STREAM, ("2606:4700:4700::1111", 443)),
    ("udp4", socket.AF_INET, socket.SOCK_DGRAM, ("1.1.1.1", 53)),
)
OFFBOX_ERRNOS = frozenset({"ENETUNREACH", "EACCES", "EPERM"})

MIB = 1024 * 1024
LOG_CAP = 8 * MIB
REPORT_CAP = 32 * MIB
EXCERPT_CAP = 64 * 1024
EXCERPT_FILES = ("RESULT.json", "inner.json", "browser-evidence.json", "chrome-sandbox.json")
BUILD_EXCERPT_FILES = ("inner-build.json", "stage-build.json", "bwrap-build.log", "build.log")
BUILD_EXCERPT_CAP = 128 * 1024
BUILD_META_RESERVE = 512
BUILD_TRAILER_RESERVE = 96
BUILD_HASH_CAP = REPORT_CAP
BUILD_JSON_PARSE_CAP = MIB
BUILD_JSON_DEPTH = 64
BUILD_JSON_NODES = 100_000
BUILD_META_KEYS = ("bytes", "json", "newlines", "sha256", "sha256_bytes", "sha256_complete", "state", "tail_offset")
BUILD_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
BUILD_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
POLL = 0.25
PREPARE_STEP_TIMEOUT = 240
BUILD_TIMEOUT = 330
RUN_TIMEOUT = 150
INNER_TIMEOUT = 125
BROWSER_DEADLINE_MS = 95_000
GATE_LAUNCH_TIMEOUT = 40

KINDS = ("normal", "malicious", "missing-message", "null-json", "malformed-json", "fetch-failure")
VIEWPORTS = ("desktop", "mobile")
EXPECTED_CASES = tuple(f"{k}-{v}" for k in KINDS for v in VIEWPORTS)

SECRET_KEY_RE = re.compile(
    r"TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|STRIPE|RESEND|SENTRY|"
    r"AWS_|GITHUB_|ACTIONS_|RUNNER_|VERCEL|OPENAI|ANTHROPIC|SUPABASE|DIRECT_URL",
    re.I,
)
NS_ENV_KEYS = frozenset({
    "PATH", "HOME", "TMPDIR", "LANG", "CI", "NODE_ENV", "NEXT_TELEMETRY_DISABLED",
    "DATABASE_URL", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "PWD",
})
DRIVER_ENV_KEYS = NS_ENV_KEYS | frozenset({
    "OT_ORIGIN", "OT_OUT", "OT_PROFILE", "OT_CHROME", "OT_APP", "OT_DEADLINE_MS",
})
CHROME_ENV_KEYS = frozenset({"PATH", "HOME", "TMPDIR", "LANG", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "PWD"})
ENV_KEY_PREFIXES = ("__NEXT_PRIVATE_", "PW_")

FORBIDDEN_CHROME_FLAGS = frozenset({
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-namespace-sandbox",
    "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox",
    "--single-process", "--no-zygote", "--in-process-gpu",
})
# Chromium's own unsandboxed helper zygote carries this legitimately; the GPU
# process it spawns inherits it. It is only forbidden everywhere else.
ZYGOTE_ONLY_FLAG = "--no-zygote-sandbox"
ZYGOTE_ONLY_TYPES = frozenset({"zygote", "gpu-process"})

# chrome://sandbox row labels are recalled from Chromium's sandbox_internals page
# and UNVERIFIED offline; an unknown layout fails closed to HOLD.
SANDBOX_ROWS = (
    ("namespace", r"^\s*(Layer 1 Sandbox[ \t:]+Namespace|Namespace Sandbox[ \t:]+Yes)\s*$"),
    ("pid_namespaces", r"^\s*PID namespaces[ \t:]+Yes\s*$"),
    ("network_namespaces", r"^\s*Network namespaces[ \t:]+Yes\s*$"),
    ("seccomp_bpf", r"^\s*Seccomp-BPF sandbox[ \t:]+Yes\s*$"),
    ("adequate", r"^\s*You are adequately sandboxed\.?\s*$"),
)

NS_PUBLIC_RO = ("/etc/ld.so.cache", "/etc/fonts", "/etc/alternatives")
NS_ABSENT_PATHS = (
    "/home", "/root", "/run", "/var", "/mnt", "/media", "/srv", "/opt/hostedtoolcache",
    "/etc/shadow", "/etc/sudoers", NS_APP + "/.git", NS_APP + "/.env", NS_APP + "/.env.local",
)
NS_READONLY_PROBES = (NS_APP, NS_APP + "/.next", NS_APP + "/node_modules", NS_HARNESS, NS_BROWSERS)


class StageStop(Exception):
    def __init__(self, status, problems):
        super().__init__("; ".join(problems))
        self.status = status
        self.problems = list(problems)


class Layout:
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.app = self.root / "app"
        self.harness = self.root / "harness"
        self.browsers = self.root / "browsers"
        self.report = self.root / "report"
        self.tmp_build = self.root / "tmp-build"
        self.tmp_run = self.root / "tmp-run"
        self.home = self.root / "home"
        self.npm_cache = self.root / "npm-cache"
        self.etc = self.root / "etc"
        self.outside = self.root / "outside"
        self.work = self.root / "work"

    def owned_dirs(self):
        return (self.root, self.app, self.harness, self.browsers, self.report, self.tmp_build,
                self.tmp_run, self.home, self.npm_cache, self.etc, self.outside, self.work)

    def create(self):
        for d in self.owned_dirs():
            d.mkdir(mode=0o700, parents=True, exist_ok=True)


# --- pure source validation ---------------------------------------------------

def parse_ls_tree(text):
    """`git ls-tree -r -z` output -> {path: (mode, type, oid)}."""
    tree = {}
    for entry in text.split("\0"):
        if not entry:
            continue
        meta, path = entry.split("\t", 1)
        mode, kind, oid = meta.split()
        tree[path] = (mode, kind, oid)
    return tree


def tree_delta(pin_tree, head_tree):
    problems = []
    for path, entry in sorted(pin_tree.items()):
        if path in QA_FILES:
            problems.append(f"qa path already in pin: {path}")
        elif path not in head_tree:
            problems.append(f"removed: {path}")
        elif path == CI_PATH:
            # The bytes may differ, proven by ci_delta_problems; mode and type may not.
            if head_tree[path][:2] != entry[:2]:
                problems.append(f"changed: {path}")
        elif head_tree[path] != entry:
            problems.append(f"changed: {path}")
    for path in sorted(set(head_tree) - set(pin_tree) - QA_FILES):
        problems.append(f"added: {path}")
    for path in sorted(QA_FILES - set(head_tree)):
        problems.append(f"qa file missing: {path}")
    return problems


def split_ci(text):
    """Candidate ci.yml -> (text with the additions removed, QA block), or None."""
    if text.count(CI_QA_MARKER) != 1:
        return None
    restored, block = text.split(CI_QA_MARKER)
    for name in CI_GUARDED_JOB_NAMES:
        if restored.count(name + CI_SKIP_GUARD) != 1:
            return None
        restored = restored.replace(name + CI_SKIP_GUARD, name)
    return restored, CI_QA_MARKER + block


def ci_block_problems(block):
    """The QA block must stay one fixed, unprivileged job at the end of the file."""
    lines = [line for line in block.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    text = "\n".join(lines) + "\n"
    problems = [f"unexpected ci.yml QA line: {line.strip()}" for line in lines
                if not line.startswith("    ") and line != "  browser-qa:"]
    if lines[:1] != ["  browser-qa:"]:
        problems.append("ci.yml QA block is not the browser-qa job")
    if re.findall(r"(?m)^    if:.*\n", text) != [CI_RUN_GUARD]:
        problems.append("ci.yml QA job guard differs")
    for required in ("    runs-on: ubuntu-22.04\n", "    timeout-minutes: 15\n", "          persist-credentials: false\n"):
        if text.count(required) != 1:
            problems.append(f"ci.yml QA job lacks: {required.strip()}")
    if tuple(re.findall(r"(?m)^\s+(?:- )?uses: (\S+)$", text)) != CI_QA_ACTIONS:
        problems.append("ci.yml QA job actions differ")
    if text.count("/usr/bin/python3 -I scripts/ot-linux-qa.py ") != 5:
        problems.append("ci.yml QA job stages differ")
    problems += [f"ci.yml QA job contains: {word}" for word in CI_QA_FORBIDDEN if word in text]
    return problems


def ci_delta_problems(baseline, candidate):
    """Both texts are required: a missing baseline can never read as no change."""
    if not baseline or not candidate:
        return ["ci.yml baseline or candidate unavailable"]
    problems = []
    if hashlib.sha256(baseline.encode("utf-8", "surrogateescape")).hexdigest() != CI_BASELINE_SHA256:
        problems.append("pinned ci.yml is not the accepted baseline")
    parts = split_ci(candidate)
    if parts is None:
        return problems + ["ci.yml lacks the authorized guards or QA job"]
    restored, block = parts
    if restored != baseline:
        problems.append("ci.yml differs from the pin outside the authorized additions")
    return problems + ci_block_problems(block)


def ci_source_problems(pin_tree, head_tree, baseline, candidate):
    """Ties the compared text to the same blobs the tree comparison looked at."""
    problems = []
    for label, tree, text in (("pin", pin_tree, baseline), ("HEAD", head_tree, candidate)):
        entry = tree.get(CI_PATH)
        if entry is None or text is None or entry[2] != blob_oid(text.encode("utf-8", "surrogateescape")):
            problems.append(f"{label} ci.yml text does not match its tree entry")
    return problems + ci_delta_problems(baseline, candidate)


def evaluate_source(ref, sha, head, is_ancestor, porcelain, pin_tree, head_tree, pin_tree_oid, baseline_ci, head_ci):
    problems = []
    if ref != BRANCH_REF:
        problems.append(f"wrong ref: {ref}")
    if not re.fullmatch(r"[0-9a-f]{40}", head or "") or head != sha:
        problems.append("HEAD is not the dispatched commit")
    if not is_ancestor:
        problems.append("pin is not an ancestor of HEAD")
    if porcelain.strip():
        problems.append("working tree is not clean")
    if not pin_tree:
        problems.append("pin tree unavailable")
    if pin_tree_oid != PIN_TREE:
        problems.append("pin does not resolve to the accepted tree")
    return problems + tree_delta(pin_tree, head_tree) + ci_source_problems(pin_tree, head_tree, baseline_ci, head_ci)


def is_env_path(path):
    return pathlib.PurePosixPath(path).name.startswith(".env")


def expected_stage_tree(pin_tree):
    return {p: e for p, e in pin_tree.items() if not is_env_path(p)}


def blob_oid(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def stage_entry(path):
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode):
        return ("120000", "blob", blob_oid(os.readlink(path).encode()))
    mode = "100755" if info.st_mode & stat.S_IXUSR else "100644"
    with open(path, "rb") as fh:
        return (mode, "blob", blob_oid(fh.read()))


def stage_tree_problems(app, expected, allowed_drift=frozenset()):
    """Every expected tracked file must be byte- and mode-identical in the stage."""
    problems = []
    for rel, entry in sorted(expected.items()):
        target = os.path.join(app, rel)
        if rel in allowed_drift:
            continue
        if not os.path.lexists(target):
            problems.append(f"stage missing: {rel}")
        elif entry[1] != "blob" or stage_entry(target) != entry:
            problems.append(f"stage differs: {rel}")
    return problems


def wrapper_problems(text):
    """The comment names a migration, so only actual execSync calls count."""
    commands = re.findall(r"""execSync\(\s*["'`]([^"'`]*)["'`]""", text)
    return [] if commands == WRAPPER_COMMANDS else [f"unexpected build commands: {commands}"]


def build_output_problems(next_dir):
    # BUILD_ID alone can come from compile-only mode; these need the full build.
    required = ("BUILD_ID", "prerender-manifest.json", "required-server-files.json", "routes-manifest.json")
    return [f"missing .next/{n}" for n in required if not os.path.isfile(os.path.join(next_dir, n))]


# --- pure environment and namespace policy --------------------------------------

def env_key_problems(keys, allowed):
    problems = []
    for key in sorted(keys):
        if key in allowed or key.startswith(ENV_KEY_PREFIXES):
            continue
        problems.append(f"env key not allowed: {key}")
    return problems


def assert_safe_env(env):
    for key, value in env.items():
        if SECRET_KEY_RE.search(key):
            raise StageStop("FAIL", [f"secret-like env key refused: {key}"])
        if key == "DATABASE_URL" and value != SYNTHETIC_DSN:
            raise StageStop("FAIL", ["DATABASE_URL is not the synthetic DSN"])
    return env


def scrubbed_env(**extra):
    """Built from nothing: the parent environment is never an input."""
    return assert_safe_env({"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", **extra})


def namespace_env(mode):
    env = {
        "PATH": f"{NS_NODE}/bin:/usr/bin",
        "HOME": "/tmp/home",
        "TMPDIR": "/tmp",
        "LANG": "C.UTF-8",
        "CI": "1",
        "NEXT_TELEMETRY_DISABLED": "1",
        "DATABASE_URL": SYNTHETIC_DSN,
        "XDG_CACHE_HOME": "/tmp/cache",
        "XDG_CONFIG_HOME": "/tmp/config",
    }
    if mode == "build":
        env["PATH"] = f"{NS_APP}/node_modules/.bin:{env['PATH']}"
    else:
        env["NODE_ENV"] = "production"
    return assert_safe_env(env)


def build_bwrap_argv(layout, node_root, mode, inner_argv, info_fd):
    if mode not in ("build", "runtime"):
        raise ValueError(mode)
    build = mode == "build"
    argv = [
        BWRAP, "--unshare-all", "--unshare-user", "--die-with-parent", "--new-session",
        "--clearenv", "--hostname", "ot-qa",
        "--ro-bind", "/usr", "/usr", "--tmpfs", "/usr/local",
        "--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin",
        "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    ]
    for path in NS_PUBLIC_RO:
        argv += ["--ro-bind", path, path]
    for name in ("passwd", "group", "hosts"):
        argv += ["--ro-bind", str(layout.etc / name), f"/etc/{name}"]
    argv += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/dev/shm"]
    argv += ["--ro-bind", str(node_root), NS_NODE]
    argv += ["--bind" if build else "--ro-bind", str(layout.app), NS_APP]
    argv += ["--ro-bind", str(layout.harness), NS_HARNESS]
    argv += ["--bind", str(layout.report), NS_OUT]
    argv += ["--bind", str(layout.tmp_build if build else layout.tmp_run), "/tmp"]
    if not build:
        argv += ["--ro-bind", str(layout.browsers), NS_BROWSERS]
        argv += ["--tmpfs", NS_APP + "/.next/cache"]
    for key, value in namespace_env(mode).items():
        argv += ["--setenv", key, value]
    argv += ["--info-fd", str(info_fd), "--chdir", NS_APP, "--"]
    return argv + list(inner_argv)


BWRAP_NOARG = frozenset({"--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--clearenv"})
BWRAP_ONEARG = frozenset({"--hostname", "--proc", "--dev", "--tmpfs", "--info-fd", "--chdir"})
BWRAP_TWOARG = frozenset({"--ro-bind", "--bind", "--symlink", "--setenv"})


def bwrap_problems(argv, layout, node_root, mode):
    """Allowlist check over the real argv; anything unrecognised is refused."""
    build = mode == "build"
    read_only = {"/usr", str(node_root), str(layout.harness), *NS_PUBLIC_RO}
    read_only |= {str(layout.etc / n) for n in ("passwd", "group", "hosts")}
    writable = {str(layout.report), str(layout.tmp_build if build else layout.tmp_run)}
    if build:
        writable.add(str(layout.app))
    else:
        read_only |= {str(layout.app), str(layout.browsers)}
    problems = [] if argv and argv[0] == BWRAP else ["argv[0] is not bwrap"]
    seen = set()
    i = 1
    while i < len(argv) and argv[i] != "--":
        flag = argv[i]
        seen.add(flag)
        if flag in BWRAP_NOARG:
            i += 1
        elif flag in BWRAP_ONEARG:
            i += 2
        elif flag in BWRAP_TWOARG:
            first, second = argv[i + 1], argv[i + 2]
            if flag == "--ro-bind" and first not in read_only:
                problems.append(f"read-only source not allowed: {first}")
            elif flag == "--bind" and first not in writable:
                problems.append(f"writable source not allowed: {first}")
            elif flag == "--setenv":
                problems += env_key_problems([first], NS_ENV_KEYS)
                if SECRET_KEY_RE.search(first):
                    problems.append(f"secret-like env refused: {first}")
                if first == "DATABASE_URL" and second != SYNTHETIC_DSN:
                    problems.append("DATABASE_URL is not the synthetic DSN")
            i += 3
        else:
            problems.append(f"flag not allowed: {flag}")
            i += 1
    if i >= len(argv):
        problems.append("no inner command separator")
    for required in ("--unshare-all", "--unshare-user", "--die-with-parent", "--clearenv", "--proc"):
        if required not in seen:
            problems.append(f"required flag missing: {required}")
    return problems


def assess_userns(clone, restrict, max_namespaces):
    """Values are raw /proc/sys strings, or None when the sysctl does not exist."""
    problems = []
    if clone is not None and clone.strip() != "1":
        problems.append("kernel.unprivileged_userns_clone is not 1")
    if restrict is not None and restrict.strip() != "0":
        problems.append("kernel.apparmor_restrict_unprivileged_userns is restrictive")
    if max_namespaces is None or not max_namespaces.strip().isdigit() or int(max_namespaces) < 1:
        problems.append("user.max_user_namespaces does not allow namespaces")
    return problems


def bwrap_binary_problems(mode, euid):
    problems = []
    if mode & (stat.S_ISUID | stat.S_ISGID):
        problems.append("bwrap is setuid/setgid; regular-user namespaces are required")
    if euid == 0:
        problems.append("harness must not run as root")
    return problems


def node_root_problems(node_root):
    if not str(node_root).startswith("/opt/hostedtoolcache/node/"):
        return [f"node root outside the public tool cache: {node_root}"]
    return []


# --- pure fence evaluation ------------------------------------------------------

def offbox_blocked(result):
    """Only a kernel routing/permission denial counts; refused and timeouts do not."""
    return result.get("errno") in OFFBOX_ERRNOS and not result.get("connected") and not result.get("timeout")


def evaluate_offbox(results):
    if {r.get("name") for r in results} != {t[0] for t in OFFBOX_TARGETS}:
        return ["offbox probe set incomplete"]
    return [f"offbox not kernel-denied: {r}" for r in results if not offbox_blocked(r)]


def evaluate_fence(fence):
    problems = []
    if not fence.get("loopback", {}).get("ok"):
        problems.append("loopback HTTP control failed")
    problems += evaluate_offbox(fence.get("offbox", []))
    tripwire = fence.get("tripwire", {})
    if tripwire.get("readable") or tripwire.get("errno") is None:
        problems.append("outside tripwire was readable or not probed")
    readonly = fence.get("readonly", {})
    if set(readonly) != set(NS_READONLY_PROBES):
        problems.append("read-only probe set incomplete")
    problems += [f"not read-only: {p}" for p, e in sorted(readonly.items()) if e != "EROFS"]
    if not fence.get("tmp_write", {}).get("ok"):
        problems.append("owned tmp is not writable")
    if fence.get("exposed", ["unprobed"]):
        problems.append(f"host paths exposed: {fence.get('exposed', ['unprobed'])}")
    if fence.get("canary_seen", True):
        problems.append("host environment canary reached the namespace")
    problems += fence.get("env_problems", ["env unprobed"])
    return problems


def faulty_fences(good):
    """Deliberately broken control results; the detector must reject every one."""
    def fault(name, mutate):
        bad = copy.deepcopy(good)
        mutate(bad)
        return name, bad

    def offbox(**result):
        return lambda f: f["offbox"][0].update({"errno": None, "connected": False, "timeout": False, **result})

    return [
        fault("offbox-connected", offbox(connected=True)),
        fault("offbox-refused", offbox(errno="ECONNREFUSED")),
        fault("offbox-timeout", offbox(timeout=True)),
        fault("offbox-missing", lambda f: f["offbox"].pop()),
        fault("loopback-down", lambda f: f["loopback"].update(ok=False)),
        fault("tripwire-readable", lambda f: f["tripwire"].update(readable=True)),
        fault("source-writable", lambda f: f["readonly"].update({NS_APP: None})),
        fault("tmp-not-writable", lambda f: f["tmp_write"].update(ok=False)),
        fault("host-path-exposed", lambda f: f["exposed"].append("/home")),
        fault("canary-seen", lambda f: f.update(canary_seen=True)),
        fault("env-leak", lambda f: f["env_problems"].append("env key not allowed: X")),
    ]


def detector_selftest(fence):
    undetected = [name for name, bad in faulty_fences(fence) if not evaluate_fence(bad)]
    cases = len(faulty_fences(fence))
    return {"ok": not undetected, "faulty_cases": cases, "undetected": undetected}


# --- pure browser gates ---------------------------------------------------------

def chrome_type(argv):
    for arg in argv:
        if arg.startswith("--type="):
            return arg.split("=", 1)[1]
    return None


def chrome_flag_problems(argv):
    problems = []
    kind = chrome_type(argv)
    for arg in argv[1:]:
        flag = arg.split("=", 1)[0]
        if flag in FORBIDDEN_CHROME_FLAGS:
            problems.append(f"forbidden chromium flag: {flag}")
        if flag == ZYGOTE_ONLY_FLAG and kind not in ZYGOTE_ONLY_TYPES:
            problems.append(f"{flag} on process type {kind}")
    return problems


def evaluate_chrome_processes(processes, chrome):
    """Inspect every /proc cmdline in the namespace, not the launch configuration."""
    problems = []
    for proc in processes:
        problems += chrome_flag_problems(proc["argv"])
    main = [p for p in processes if p["argv"] and p["argv"][0] == chrome and chrome_type(p["argv"]) is None]
    if len(main) != 1:
        problems.append(f"expected one main chromium process, saw {len(main)}")
    kinds = {chrome_type(p["argv"]) for p in processes}
    for needed in ("zygote", "renderer"):
        if needed not in kinds:
            problems.append(f"no {needed} process observed")
    return problems, (main[0] if len(main) == 1 else None)


def evaluate_sandbox_text(text):
    return [f"chrome://sandbox lacks {name}" for name, pattern in SANDBOX_ROWS
            if not re.search(pattern, text or "", re.M)]


def namespace_problems(label, ids, reference):
    problems = []
    for name in ("net", "mnt", "pid", "user"):
        if not reference.get(name) or ids.get(name) != reference.get(name):
            problems.append(f"{label} not in the same {name} namespace")
    return problems


def evaluate_browser_evidence(evidence):
    if not isinstance(evidence, dict):
        return ["browser evidence missing"]
    problems = [] if evidence.get("ok") is True else [f"browser reported failure: {evidence.get('error')}"]
    cases = evidence.get("cases", {})
    for name in EXPECTED_CASES:
        status = cases.get(name, {}).get("status", "notrun")
        if status != "pass":
            problems.append(f"case {name}: {status}")
    if set(cases) != set(EXPECTED_CASES):
        problems.append("case set differs from expected")
    control = evidence.get("control") or {}
    if not control.get("ok"):
        problems.append("interception control failed or did not run")
    counts = evidence.get("counts", {})
    if counts.get("controlPosts") != 1:
        problems.append("interception control POST count is not 1")
    for key in ("continuedPosts", "continuedNonGet", "unrouted", "pageErrors", "popups"):
        if counts.get(key) != 0:
            problems.append(f"{key} is {counts.get(key)!r}")
    return problems


def final_gate(stages, inner, host_cleanup, artifact):
    """Positive only when every stage, the fence, cleanup and the bound all held."""
    problems = []
    for name in ("validate", "prepare", "build"):
        if stages.get(name) != "PASS":
            problems.append(f"stage {name}: {stages.get(name)}")
    inner_status = (inner or {}).get("status")
    if inner_status != "PASS":
        problems.append(f"inner run: {inner_status}")
    cleanup = (inner or {}).get("cleanup") or {}
    if cleanup.get("ok") is not True:
        problems.append("namespace cleanup not proven")
    problems += host_cleanup
    problems += artifact.get("problems", ["artifact unmeasured"])
    if not problems:
        return "PASS", problems
    return ("HOLD" if inner_status == "HOLD" else "FAIL"), problems


# --- bounded process and report helpers ----------------------------------------

def terminate_group(proc, killpg, clock, sleep, grace=5.0):
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, grace)):
        try:
            killpg(proc.pid, sig)
        except ProcessLookupError:
            pass
        end = clock() + wait
        while proc.poll() is None and clock() < end:
            sleep(POLL)
        if proc.poll() is not None:
            return


def run_bounded(argv, log_path, timeout, env, cwd=None, cap=LOG_CAP, pass_fds=(),
                popen=None, killpg=None, clock=time.monotonic, sleep=time.sleep):
    """Child output goes straight to a file, so no pipe EOF can hang the parent."""
    popen = popen or subprocess.Popen
    killpg = killpg or os.killpg
    started = clock()
    reason = None
    with open(log_path, "ab") as log:
        proc = popen(list(argv), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                     env=env, cwd=cwd, pass_fds=pass_fds, start_new_session=True)
    while proc.poll() is None:
        if clock() - started > timeout:
            reason = "timeout"
        elif file_size(log_path) > cap:
            reason = "log_cap"
        if reason:
            terminate_group(proc, killpg, clock, sleep)
            break
        sleep(POLL)
    return {"exit": proc.poll(), "reason": reason, "wall_seconds": round(clock() - started, 2),
            "log_bytes": file_size(log_path)}


def bounded_ok(result):
    return result.get("exit") == 0 and result.get("reason") is None


def file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def write_json(path, value):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2, sort_keys=True, default=str)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def parse_meminfo(text):
    out = {}
    for line in text.splitlines():
        match = re.match(r"(MemTotal|MemAvailable):\s+(\d+) kB", line)
        if match:
            out[match.group(1)] = int(match.group(2)) * 1024
    return out


def host_resources(root):
    """Measured facts only; nothing here is a configured or promised limit."""
    out = {"cpu_count": os.cpu_count(), "disk_free_bytes": shutil.disk_usage(root).free}
    if hasattr(os, "sched_getaffinity"):
        out["cpu_affinity"] = len(os.sched_getaffinity(0))
    try:
        out.update(parse_meminfo(pathlib.Path("/proc/meminfo").read_text()))
        out["cgroup_memory_max"] = pathlib.Path("/sys/fs/cgroup/memory.max").read_text().strip()
    except OSError:
        pass
    return out


def tree_bytes(root):
    total = 0
    for base, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.lstat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return total


def artifact_report(report_dir, canary=None):
    """Observed once at the end of the stage: this is not a continuous guarantee."""
    problems = []
    total = 0
    files = 0
    for base, _dirs, names in os.walk(report_dir):
        for name in names:
            path = os.path.join(base, name)
            info = os.lstat(path)
            files += 1
            total += info.st_size
            if not stat.S_ISREG(info.st_mode):
                problems.append(f"non-regular report entry: {name}")
            elif not name.endswith((".json", ".log", ".png")):
                problems.append(f"unexpected report file: {name}")
            elif canary and info.st_size <= LOG_CAP:
                with open(path, "rb") as fh:
                    if canary.encode() in fh.read():
                        problems.append(f"canary found in report: {name}")
    if total > REPORT_CAP:
        problems.append(f"report {total} bytes exceeds cap {REPORT_CAP}")
    return {"files": files, "total_bytes": total, "cap_bytes": REPORT_CAP, "problems": problems,
            "measurement": "single end-of-stage observation"}


def report_excerpt(report_dir):
    """Named JSON evidence only, each file bounded: the job log is the report's only exit."""
    lines = []
    for name in EXCERPT_FILES:
        path = os.path.join(report_dir, name)
        if not os.path.isfile(path) or os.path.islink(path):
            lines.append(f"--- {name}: absent")
            continue
        with open(path, "rb") as fh:
            data = fh.read(EXCERPT_CAP + 1)
        note = " (truncated)" if len(data) > EXCERPT_CAP else ""
        lines.append(f"--- {name}{note}")
        # ASCII: the seal step runs with an empty locale and must not die printing.
        lines.append(data[:EXCERPT_CAP].decode("utf-8", "replace").encode("ascii", "backslashreplace").decode())
    return lines


class _DuplicateKey(ValueError):
    pass


def _unique_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise _DuplicateKey(key)
        out[key] = value
    return out


def _reject_constant(name):
    raise ValueError(name)


def _json_exceeds_bounds(value):
    """Iterative, so a deep or self-referencing value can only exhaust the bounds."""
    stack = [(value, 1)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if depth > BUILD_JSON_DEPTH or nodes > BUILD_JSON_NODES:
            return True
        if isinstance(item, dict):
            stack += [(child, depth + 1) for child in item.values()]
        elif isinstance(item, list):
            stack += [(child, depth + 1) for child in item]
    return False


def classify_build_json(data):
    """A label only: the raw windows are emitted either way, so bad JSON loses nothing."""
    try:
        value = json.loads(data, object_pairs_hook=_unique_keys, parse_constant=_reject_constant)
    except _DuplicateKey:
        return "duplicate_key", None
    except RecursionError:
        return "too_deep", None
    except ValueError:
        return "malformed", None
    return ("too_deep", None) if _json_exceeds_bounds(value) else ("valid", value)


def open_report_dir(report_dir):
    """The report directory and its parent are both opened without following a link."""
    path = os.path.abspath(report_dir)
    parent = os.open(os.path.dirname(path), BUILD_DIR_FLAGS)
    try:
        fd = os.open(os.path.basename(path), BUILD_DIR_FLAGS, dir_fd=parent)
    finally:
        os.close(parent)
    if os.fstat(fd).st_uid != os.geteuid():
        os.close(fd)
        raise PermissionError(errno.EPERM, "report directory owner")
    return fd


def _pread_all(fd, count, offset):
    chunks = []
    while count > 0:
        chunk = os.pread(fd, min(count, MIB), offset)
        if not chunk:
            break
        chunks.append(chunk)
        count -= len(chunk)
        offset += len(chunk)
    return b"".join(chunks)


def _measure_build_file(fd, name, size, window):
    digest = hashlib.sha256()
    newlines = hashed = 0
    limit = min(size, BUILD_HASH_CAP)
    while hashed < limit:
        chunk = os.pread(fd, min(limit - hashed, MIB), hashed)
        if not chunk:
            break
        digest.update(chunk)
        newlines += chunk.count(b"\n")
        hashed += len(chunk)
    head_size = min(size, window)
    tail_size = min(size - head_size, window)
    out = {"state": "ok", "bytes": size, "sha256": digest.hexdigest(), "sha256_bytes": hashed,
           "sha256_complete": hashed == size, "newlines": newlines, "tail_offset": size - tail_size,
           "head": _pread_all(fd, head_size, 0), "tail": _pread_all(fd, tail_size, size - tail_size),
           "json": None, "value": None}
    if name.endswith(".json"):
        if size > BUILD_JSON_PARSE_CAP:
            out["json"] = "oversize"
        else:
            out["json"], out["value"] = classify_build_json(_pread_all(fd, size, 0))
    return out


def read_build_file(dir_fd, name, window):
    """All facts come from one no-follow descriptor; a refused file reports nothing about its bytes.

    The build namespace can write the report directory, so at seal time a link or
    a FIFO here is hostile. O_NONBLOCK keeps a FIFO from hanging the open.
    """
    try:
        fd = os.open(name, BUILD_FILE_FLAGS, dir_fd=dir_fd)
    except FileNotFoundError:
        return {"state": "absent"}
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.EMLINK):
            return {"state": "refused:symlink"}
        return {"state": f"unreadable:{errno.errorcode.get(exc.errno, 'unknown')}"}
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return {"state": "refused:not-regular"}
        if info.st_nlink != 1:
            return {"state": "refused:hardlink"}
        if info.st_uid != os.geteuid():
            return {"state": "refused:owner"}
        return _measure_build_file(fd, name, info.st_size, window)
    except OSError as exc:
        return {"state": f"unreadable:{errno.errorcode.get(exc.errno, 'unknown')}"}
    finally:
        os.close(fd)


def excerpt_lines(data):
    """ASCII with no controls, and every line prefixed, so log text cannot act as a
    runner workflow command or pass for a harness line in the job log."""
    if not data:
        return []
    text = data.decode("utf-8", "backslashreplace").encode("ascii", "backslashreplace").decode()
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", lambda m: f"\\x{ord(m.group()):02x}", text)
    return ["| " + line.replace("##[", "#\\x23[") for line in text.removesuffix("\n").split("\n")]


def fit_lines(lines, allowance):
    kept = []
    for line in lines:
        room = allowance - len(line) - 1
        if room < 0:
            if allowance > 3:
                kept.append(line[:allowance - 1])
            return kept, 0, True
        kept.append(line)
        allowance = room
    return kept, allowance, False


def render_build_file(name, report, allowance):
    prefix = f"--- build failure {name}"
    if report["state"] != "ok":
        return [f"{prefix}: {json.dumps({'state': report['state']})}"]
    body = allowance - BUILD_META_RESERVE
    head, left, head_cut = fit_lines(excerpt_lines(report["head"]), body // 2)
    # Fitted backwards: the last lines of a failed build are the ones worth keeping.
    tail, _, tail_cut = fit_lines(excerpt_lines(report["tail"])[::-1], left + body - body // 2)
    tail.reverse()
    head_size, tail_size = len(report["head"]), len(report["tail"])
    omitted = report["bytes"] - head_size - tail_size
    meta = {key: report[key] for key in BUILD_META_KEYS}
    meta.update(head_bytes=head_size, tail_bytes=tail_size, omitted_bytes=omitted, truncated=omitted > 0,
                output_cut=head_cut or tail_cut)
    lines = [f"{prefix}: {json.dumps(meta, sort_keys=True)}"]
    if head_size:
        lines += [f"{prefix} head offset=0 bytes={head_size}", *head]
    if tail_size:
        lines += [f"{prefix} tail offset={report['tail_offset']} bytes={tail_size}", *tail]
    return lines


def build_failure_excerpt(report_dir):
    """Fixed names on a failed build only, windowed under one outbound cap.

    A passing build, or a run that never reached it, prints nothing here: the
    normal run keeps build.log out of the job log exactly as before.
    """
    try:
        dir_fd = open_report_dir(report_dir)
    except OSError as exc:
        return [f"--- build failure excerpt: report directory refused: {errno.errorcode.get(exc.errno, 'unknown')}"]
    # Equal shares, so one huge or hostile file cannot starve the others.
    cap = BUILD_EXCERPT_CAP
    share = (cap - BUILD_TRAILER_RESERVE) // len(BUILD_EXCERPT_FILES)
    window = max(share - BUILD_META_RESERVE, 0) * 3 // 8
    try:
        reports = {name: read_build_file(dir_fd, name, window) for name in BUILD_EXCERPT_FILES}
    finally:
        os.close(dir_fd)
    stage = reports["stage-build.json"]
    if isinstance(stage.get("value"), dict) and stage["value"].get("status") == "PASS":
        return []
    if all(report["state"] == "absent" for report in reports.values()):
        return []
    lines = []
    for name in BUILD_EXCERPT_FILES:
        lines += render_build_file(name, reports[name], share)
    kept, _, cut = fit_lines(lines, cap - BUILD_TRAILER_RESERVE)
    chars = sum(len(line) + 1 for line in kept)
    return kept + [f"--- build failure excerpt: chars={chars} cap={cap} cut={str(cut).lower()}"]


def print_build_failure_excerpt(report_dir):
    """Diagnostics only: nothing here may change or hide the sealed result."""
    try:
        for line in build_failure_excerpt(report_dir):
            print(line, flush=True)
    except Exception as exc:  # noqa: BLE001 - the type alone, so no file text is echoed
        print(f"--- build failure excerpt unavailable: {type(exc).__name__}", flush=True)


def enforce_report_cap(report_dir):
    """Keep what is uploaded bounded even after a killed step: largest files go first."""
    entries = []
    for base, _dirs, names in os.walk(report_dir):
        for name in names:
            path = os.path.join(base, name)
            if stat.S_ISREG(os.lstat(path).st_mode):
                entries.append((os.path.getsize(path), path))
            else:
                os.unlink(path)
    total = sum(size for size, _path in entries)
    dropped = []
    for size, path in sorted(entries, reverse=True):
        if total <= REPORT_CAP:
            break
        os.unlink(path)
        total -= size
        dropped.append(os.path.basename(path))
    return dropped


# --- namespace process inspection ----------------------------------------------

def ns_ids(pid, proc="/proc"):
    out = {}
    for name in ("net", "mnt", "pid", "user", "ipc", "uts"):
        try:
            out[name] = os.readlink(f"{proc}/{pid}/ns/{name}")
        except OSError:
            out[name] = None
    return out


def proc_argv(pid, proc="/proc"):
    """Chromium retitles itself into one space-joined element, so a lone element is re-tokenised."""
    try:
        with open(f"{proc}/{pid}/cmdline", "rb") as fh:
            argv = [a.decode("utf-8", "replace") for a in fh.read().split(b"\0") if a]
    except OSError:
        return []
    return argv[0].split() if len(argv) == 1 else argv


def proc_env_keys(pid, proc="/proc"):
    """Names only: values are never copied into evidence."""
    try:
        with open(f"{proc}/{pid}/environ", "rb") as fh:
            items = fh.read().split(b"\0")
    except OSError:
        return None
    return sorted(i.split(b"=", 1)[0].decode("utf-8", "replace") for i in items if i)


def list_pids(proc="/proc"):
    return sorted(int(n) for n in os.listdir(proc) if n.isdigit())


def parse_proc_net_tcp(text):
    """Row: sl local rem st tx:rx tr:when retrnsmt uid timeout inode ...

    The header has more words than rows have columns: it splits the two pairs
    that rows join with ":". A row of any other shape would put the UID at the
    inode index, so it is dropped and the listener check fails closed.
    """
    rows = []
    for line in text.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 10 or ":" not in fields[4] or ":" not in fields[5]:
            continue
        address, port = fields[1].rsplit(":", 1)
        rows.append({"address": address, "port": int(port, 16), "state": fields[3], "inode": fields[9]})
    return rows


def listeners(port, proc="/proc"):
    rows = []
    for name in ("tcp", "tcp6"):
        try:
            with open(f"{proc}/net/{name}", encoding="ascii") as fh:
                rows += [r for r in parse_proc_net_tcp(fh.read()) if r["state"] == "0A" and r["port"] == port]
        except OSError:
            pass
    return rows


def socket_owners(inodes, proc="/proc"):
    wanted = {f"socket:[{i}]" for i in inodes}
    owners = set()
    for pid in list_pids(proc):
        try:
            for fd in os.listdir(f"{proc}/{pid}/fd"):
                if os.readlink(f"{proc}/{pid}/fd/{fd}") in wanted:
                    owners.add(pid)
        except OSError:
            continue
    return sorted(owners)


def namespace_holders(net_id, proc="/proc"):
    """Host-side scan for any process still inside the finished namespace."""
    holders = []
    for pid in list_pids(proc):
        try:
            if os.readlink(f"{proc}/{pid}/ns/net") == net_id:
                holders.append(pid)
        except OSError:
            continue
    return holders


# --- namespace controls ---------------------------------------------------------

class _NonceHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = self.server.nonce.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def probe_loopback():
    nonce = secrets.token_hex(8)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _NonceHandler)
    server.nonce = nonce
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        conn.request("GET", "/")
        response = conn.getresponse()
        return {"ok": response.status == 200 and response.read().decode() == nonce, "status": response.status}
    except OSError as exc:
        return {"ok": False, "error": errno.errorcode.get(exc.errno, str(exc))}
    finally:
        server.shutdown()
        server.server_close()


def probe_offbox(name, family, kind, address):
    result = {"name": name, "target": address[0], "errno": None, "connected": False, "timeout": False}
    try:
        with socket.socket(family, kind) as sock:
            sock.settimeout(3)
            code = sock.connect_ex(address)
    except socket.timeout:
        result["timeout"] = True
        return result
    except OSError as exc:
        result["errno"] = errno.errorcode.get(exc.errno, str(exc.errno))
        return result
    if code == 0:
        result["connected"] = True
    elif code in (errno.EAGAIN, errno.EINPROGRESS, errno.ETIMEDOUT):
        result["timeout"] = True
    else:
        result["errno"] = errno.errorcode.get(code, str(code))
    return result


def offbox_probes():
    return [probe_offbox(*target) for target in OFFBOX_TARGETS]


def probe_readonly(path):
    probe = os.path.join(path, ".ot-readonly-probe")
    try:
        os.close(os.open(probe, os.O_CREAT | os.O_WRONLY, 0o600))
    except OSError as exc:
        return errno.errorcode.get(exc.errno, str(exc.errno))
    os.unlink(probe)
    return None


def probe_tripwire(path):
    try:
        with open(path, "rb") as fh:
            fh.read(1)
        return {"readable": True, "errno": None}
    except OSError as exc:
        return {"readable": False, "errno": errno.errorcode.get(exc.errno, str(exc.errno))}


def probe_tmp():
    path = "/tmp/.ot-write-probe"
    try:
        pathlib.Path(path).write_text("probe")
        ok = pathlib.Path(path).read_text() == "probe"
        os.unlink(path)
        return {"ok": ok}
    except OSError as exc:
        return {"ok": False, "errno": errno.errorcode.get(exc.errno, str(exc.errno))}


def environ_contains(pid, needle):
    try:
        with open(f"/proc/{pid}/environ", "rb") as fh:
            return needle.encode() in fh.read()
    except OSError:
        return False


def run_controls(tripwire, canary):
    keys = proc_env_keys("self")
    fence = {
        "loopback": probe_loopback(),
        "offbox": offbox_probes(),
        "tripwire": probe_tripwire(tripwire),
        "readonly": {p: probe_readonly(p) for p in NS_READONLY_PROBES},
        "tmp_write": probe_tmp(),
        "exposed": [p for p in NS_ABSENT_PATHS if os.path.lexists(p)],
        "canary_seen": environ_contains("self", canary) or environ_contains(1, canary),
        "self_env_keys": keys,
        "env_problems": ["self env unreadable"] if keys is None else env_key_problems(keys, NS_ENV_KEYS),
    }
    fence["problems"] = evaluate_fence(fence)
    return fence


# --- namespace lifecycle --------------------------------------------------------

def run_inner(ops):
    """Fixed order. A failed control stops before the browser; cleanup always runs."""
    ev = {"status": "FAIL", "reached": "controls", "server": "notrun", "browser": "notrun",
          "gate": "notrun", "ui": "notrun"}
    status = "FAIL"
    try:
        ev["namespace"] = ops.namespace_ids()
        ev["fence"] = ops.controls()
        ev["detector"] = detector_selftest(ev["fence"])
        if ev["fence"]["problems"] or not ev["detector"]["ok"]:
            status = "HOLD"
            return ev
        ev["reached"] = "server"
        ev["server"] = ops.start_server()
        if ev["server"]["problems"]:
            return ev
        ev["reached"] = "browser"
        ev["browser"] = ops.start_browser()
        if ev["browser"]["problems"]:
            status = "HOLD"
            return ev
        ev["reached"] = "gate"
        ev["gate"] = ops.browser_gate()
        ops.release(not ev["gate"]["problems"])
        if ev["gate"]["problems"]:
            status = "HOLD"
            return ev
        ev["reached"] = "ui"
        ev["ui"] = ops.finish_browser()
        if not ev["ui"]["problems"]:
            status = "PASS"
    except Exception as exc:  # noqa: BLE001 - any stop is recorded, then cleaned up
        ev["error"] = f"{type(exc).__name__}: {exc}"
        status = "FAIL"
    finally:
        try:
            ev["cleanup"] = ops.cleanup()
        except Exception as exc:  # noqa: BLE001
            ev["cleanup"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        if ev["cleanup"].get("ok") is not True and status == "PASS":
            status = "FAIL"
        ev["status"] = status
        ops.write(ev)
    return ev


class NamespaceOps:
    def __init__(self, args):
        self.args = args
        self.deadline = time.monotonic() + INNER_TIMEOUT
        self.server = None
        self.driver = None
        self.logs = (f"{NS_OUT}/server.log", f"{NS_OUT}/browser.log")
        self.self_ns = ns_ids("self")

    def namespace_ids(self):
        return self.self_ns

    def controls(self):
        for path in ("/tmp/home", "/tmp/cache", "/tmp/config", "/tmp/profile"):
            os.makedirs(path, exist_ok=True)
        return run_controls(self.args.tripwire, self.args.canary)

    def _spawn(self, argv, log, env):
        with open(log, "ab") as out:
            return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                    env=env, cwd=NS_APP, start_new_session=True)

    def _logs_within_cap(self):
        return all(file_size(p) <= LOG_CAP for p in self.logs)

    def start_server(self):
        env = namespace_env("runtime")
        argv = [NS_NODE_BIN, f"{NS_APP}/node_modules/next/dist/bin/next", "start",
                "-H", "127.0.0.1", "-p", str(self.args.port)]
        self.server = self._spawn(argv, self.logs[0], env)
        out = {"pid": self.server.pid, "problems": ["server not ready"]}
        end = time.monotonic() + 40
        while time.monotonic() < end and self.server.poll() is None and self._logs_within_cap():
            try:
                conn = http.client.HTTPConnection("127.0.0.1", self.args.port, timeout=3)
                conn.request("GET", "/check")
                response = conn.getresponse()
                body = response.read(2 * MIB).decode("utf-8", "replace")
                conn.close()
            except OSError:
                time.sleep(POLL)
                continue
            out["check_status"] = response.status
            out["check_title_seen"] = "Free Cook County Property Check" in body
            break
        if out.get("check_status") == 200 and out.get("check_title_seen"):
            out["problems"] = self._server_identity(out)
        return out

    def _server_identity(self, out):
        rows = listeners(self.args.port)
        out["listener_addresses"] = sorted({r["address"] for r in rows})
        owners = socket_owners([r["inode"] for r in rows])
        out["listener_pids"] = owners
        problems = [] if out["listener_addresses"] == ["0100007F"] else ["server not bound to 127.0.0.1 only"]
        if len(owners) != 1:
            return problems + [f"expected one listener owner, saw {owners}"]
        out["ns"] = ns_ids(owners[0])
        out["env_keys"] = proc_env_keys(owners[0])
        problems += namespace_problems("server", out["ns"], self.self_ns)
        problems += ["server env unreadable"] if out["env_keys"] is None else env_key_problems(out["env_keys"], NS_ENV_KEYS)
        return problems

    def start_browser(self):
        env = dict(namespace_env("runtime"))
        env.update({
            "OT_ORIGIN": f"http://127.0.0.1:{self.args.port}", "OT_OUT": NS_OUT,
            "OT_PROFILE": "/tmp/profile", "OT_CHROME": self.args.chrome, "OT_APP": NS_APP,
            "OT_DEADLINE_MS": str(BROWSER_DEADLINE_MS),
        })
        self.driver = self._spawn([NS_NODE_BIN, f"{NS_HARNESS}/ot-linux-browser.cjs"], self.logs[1], env)
        out = {"driver_pid": self.driver.pid, "problems": []}
        end = time.monotonic() + GATE_LAUNCH_TIMEOUT
        while time.monotonic() < end and self.driver.poll() is None and self._logs_within_cap():
            if os.path.exists(f"{NS_OUT}/browser-ready.json"):
                out["ready"] = read_json(f"{NS_OUT}/browser-ready.json")
                return out
            time.sleep(POLL)
        out["driver_exit"] = self.driver.poll()
        out["problems"] = ["browser did not reach the sandbox gate; chromium unsupported here"]
        return out

    def browser_gate(self):
        me = {os.getpid(), 1, self.server.pid, self.driver.pid}
        processes = [{"pid": p, "argv": proc_argv(p)} for p in list_pids() if p not in me]
        processes = [p for p in processes if p["argv"]]
        problems, main = evaluate_chrome_processes(processes, self.args.chrome)
        out = {"processes": [{"pid": p["pid"], "argv": p["argv"][:40]} for p in processes]}
        if main:
            out["main_pid"] = main["pid"]
            out["ns"] = ns_ids(main["pid"])
            out["env_keys"] = proc_env_keys(main["pid"])
            problems += namespace_problems("browser", out["ns"], self.self_ns)
            problems += ["browser env unreadable"] if out["env_keys"] is None else env_key_problems(out["env_keys"], CHROME_ENV_KEYS)
        out["driver_ns"] = ns_ids(self.driver.pid)
        out["driver_env_keys"] = proc_env_keys(self.driver.pid)
        problems += namespace_problems("driver", out["driver_ns"], self.self_ns)
        problems += ["driver env unreadable"] if out["driver_env_keys"] is None else env_key_problems(out["driver_env_keys"], DRIVER_ENV_KEYS)
        native = read_json(f"{NS_OUT}/chrome-sandbox.json") or {}
        out["chrome_sandbox_url"] = native.get("url")
        problems += evaluate_sandbox_text(native.get("text"))
        out["problems"] = problems
        return out

    def release(self, go):
        write_json(f"{NS_OUT}/gate.json", {"go": bool(go)})

    def finish_browser(self):
        while self.driver.poll() is None and time.monotonic() < self.deadline and self._logs_within_cap():
            time.sleep(POLL)
        evidence = read_json(f"{NS_OUT}/browser-evidence.json")
        out = {"driver_exit": self.driver.poll(), "problems": evaluate_browser_evidence(evidence)}
        if out["driver_exit"] != 0:
            out["problems"].append(f"driver exit {out['driver_exit']}")
        if isinstance(evidence, dict):
            out["counts"] = evidence.get("counts")
        return out

    def cleanup(self):
        for proc in (self.driver, self.server):
            if proc is not None and proc.poll() is None:
                terminate_group(proc, os.killpg, time.monotonic, time.sleep, grace=3.0)
        # PID namespace: everything but pid 1 and this process is ours by construction.
        me = {1, os.getpid()}
        for pid in list_pids():
            if pid not in me:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        end = time.monotonic() + 5
        remaining = [p for p in list_pids() if p not in me]
        while remaining and time.monotonic() < end:
            time.sleep(POLL)
            remaining = [p for p in list_pids() if p not in me]
        left = listeners(self.args.port)
        return {"ok": not remaining and not left, "remaining_pids": remaining, "listeners": left,
                "tmp_bytes_observed": tree_bytes("/tmp")}

    def write(self, ev):
        write_json(f"{NS_OUT}/inner.json", ev)


def inner_run(args):
    return 0 if run_inner(NamespaceOps(args))["status"] == "PASS" else 3


def inner_build(args):
    for path in ("/tmp/home", "/tmp/cache", "/tmp/config"):
        os.makedirs(path, exist_ok=True)
    probes = offbox_probes()
    keys = proc_env_keys("self")
    problems = evaluate_offbox(probes) + (["env unreadable"] if keys is None else env_key_problems(keys, NS_ENV_KEYS))
    ev = {"offbox": probes, "problems": problems, "build": "notrun"}
    if not problems:
        env = assert_safe_env(dict(os.environ))
        ev["build"] = run_bounded([NS_NODE_BIN, BUILD_WRAPPER], f"{NS_OUT}/build.log", args.timeout, env,
                                  cwd=NS_APP, cap=LOG_CAP)
        if not bounded_ok(ev["build"]):
            problems.append(f"build failed: {ev['build']}")
    write_json(f"{NS_OUT}/inner-build.json", ev)
    return 0 if not problems else 3


# --- host stages ----------------------------------------------------------------

def stage_runner(name, layout, body):
    """Records measured wall time and resources; a stage stop is a report, not a crash."""
    started = time.monotonic()
    before = host_resources(layout.root)
    try:
        result = body()
    except StageStop as stop:
        result = {"status": stop.status, "problems": stop.problems}
    result["wall_seconds"] = round(time.monotonic() - started, 2)
    result["resources_before"] = before
    result["resources_after"] = host_resources(layout.root)
    result["peak_child_rss_kib"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    write_json(layout.report / f"stage-{name}.json", result)
    print(f"{name}: {result['status']} {result.get('problems', [])}", flush=True)
    return 0 if result["status"] == "PASS" else 1


def stage_status(layout, name):
    return (read_json(layout.report / f"stage-{name}.json") or {}).get("status")


def require_stages(layout, names):
    problems = [f"stage {n}: {stage_status(layout, n)}" for n in names if stage_status(layout, n) != "PASS"]
    if problems:
        raise StageStop("HOLD", problems)


def capture(layout, label, argv, cwd=None, timeout=60):
    log = layout.work / f"{label}.out"
    log.unlink(missing_ok=True)
    env = scrubbed_env(HOME=str(layout.home))
    result = run_bounded(argv, log, timeout, env, cwd=cwd, cap=LOG_CAP)
    # Decoded from bytes: read_text would translate newlines and hide a CR in ci.yml.
    return result, log.read_bytes().decode("utf-8", "surrogateescape") if log.exists() else ""


def git_tree(layout, repo, rev):
    result, text = capture(layout, f"tree-{rev[:7]}", ["git", "-C", repo, "ls-tree", "-r", "-z", rev])
    return parse_ls_tree(text) if bounded_ok(result) else {}


def git_ci_text(layout, repo, rev):
    """Local object read; the pin is present because the checkout has full history."""
    result, text = capture(layout, f"ci-{rev[:7]}", ["git", "-C", repo, "cat-file", "blob", f"{rev}:{CI_PATH}"])
    return text if bounded_ok(result) else None


def validate_body(args, layout):
    repo = args.repo
    _, head = capture(layout, "head", ["git", "-C", repo, "rev-parse", "HEAD"])
    ancestor, _ = capture(layout, "ancestor", ["git", "-C", repo, "merge-base", "--is-ancestor", PIN, "HEAD"])
    _, porcelain = capture(layout, "status", ["git", "-C", repo, "status", "--porcelain"])
    _, pin_tree_oid = capture(layout, "pin-tree", ["git", "-C", repo, "rev-parse", f"{PIN}^{{tree}}"])
    pin_tree = git_tree(layout, repo, PIN)
    head_tree = git_tree(layout, repo, "HEAD")
    baseline_ci = git_ci_text(layout, repo, PIN)
    head_ci = git_ci_text(layout, repo, "HEAD")
    head = head.strip()
    problems = evaluate_source(args.ref, args.sha, head, bounded_ok(ancestor), porcelain, pin_tree, head_tree,
                               pin_tree_oid.strip(), baseline_ci, head_ci)
    if problems:
        raise StageStop("FAIL", problems[:50])
    # The app stage comes from the pin itself, so it never holds the candidate ci.yml.
    archive = layout.work / "pin.tar"
    for argv in (["git", "-C", repo, "archive", "--format=tar", "-o", str(archive), PIN],
                 ["tar", "-xf", str(archive), "-C", str(layout.app)]):
        result, _ = capture(layout, "stage", argv, timeout=60)
        if not bounded_ok(result):
            raise StageStop("FAIL", [f"staging failed: {argv[0]} {result}"])
    archive.unlink()
    for rel in HARNESS_FILES:
        shutil.copy2(os.path.join(repo, rel), layout.harness / os.path.basename(rel))
    removed = sorted(p for p in pin_tree if is_env_path(p))
    for rel in removed:
        (layout.app / rel).unlink()
    expected = expected_stage_tree(pin_tree)
    problems = stage_tree_problems(str(layout.app), expected)
    if (layout.app / ".git").exists():
        problems.append("stage contains .git")
    if problems:
        raise StageStop("FAIL", problems[:50])
    write_json(layout.work / "expected-tree.json", expected)
    return {"status": "PASS", "pin": PIN, "pin_tree": PIN_TREE, "head": head, "stage_files": len(expected),
            "env_templates_excluded": removed, "qa_files": sorted(QA_FILES), "authorized_modified": [CI_PATH]}


def read_sysctl(path):
    try:
        return pathlib.Path(path).read_text()
    except OSError:
        return None


def preflight_problems():
    problems = assess_userns(read_sysctl("/proc/sys/kernel/unprivileged_userns_clone"),
                             read_sysctl("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"),
                             read_sysctl("/proc/sys/user/max_user_namespaces"))
    try:
        problems += bwrap_binary_problems(os.stat(BWRAP).st_mode, os.geteuid())
    except OSError:
        problems.append("bwrap not installed")
    problems += [f"missing public path: {p}" for p in NS_PUBLIC_RO if not os.path.exists(p)]
    return problems


def prepare_steps(layout, node_root):
    """Public fetches only. Every step gets an explicit env; none is a sysctl change."""
    node = f"{node_root}/bin/node"
    cli = f"{layout.app}/node_modules/playwright/cli.js"
    prisma = f"{layout.app}/node_modules/prisma/build/index.js"
    env = scrubbed_env(
        PATH=f"{node_root}/bin:/usr/bin:/bin", HOME=str(layout.home),
        NPM_CONFIG_USERCONFIG=str(layout.home / ".npmrc"), NPM_CONFIG_CACHE=str(layout.npm_cache),
        NPM_CONFIG_AUDIT="false", NPM_CONFIG_FUND="false", NPM_CONFIG_UPDATE_NOTIFIER="false",
        PLAYWRIGHT_BROWSERS_PATH=str(layout.browsers), NEXT_TELEMETRY_DISABLED="1",
        DATABASE_URL=SYNTHETIC_DSN,
    )
    root_env = ["sudo", "-n", "env", "-i", "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "DEBIAN_FRONTEND=noninteractive"]
    return [
        ("apt-update", root_env + ["apt-get", "update"], env),
        ("apt-bubblewrap", root_env + ["apt-get", "install", "--yes", "--no-install-recommends", "bubblewrap"], env),
        ("npm-ci", [f"{node_root}/bin/npm", "ci", "--ignore-scripts"], env),
        # Offline-capable in theory; run here so any public Prisma engine fetch
        # stays in this labelled stage. The build repeats it inside the namespace.
        ("prisma-generate", [node, prisma, "generate"], env),
        ("playwright-deps", root_env + [node, cli, "install-deps", "chromium"], env),
        # Full Chromium, not headless-shell: chrome://sandbox needs the full UI.
        ("playwright-chromium", [node, cli, "install", "chromium", "--no-shell"], env),
    ]


def find_chrome(browsers):
    found = glob.glob(f"{browsers}/chromium-*/chrome-linux*/chrome")
    if len(found) != 1:
        raise StageStop("HOLD", [f"expected one full chromium binary, saw {len(found)}"])
    return found[0]


def prepare_body(args, layout):
    require_stages(layout, ["validate"])
    node_root = str(pathlib.Path(os.path.realpath(args.node)).parents[1])
    problems = node_root_problems(node_root)
    if problems:
        raise StageStop("HOLD", problems)
    (layout.home / ".npmrc").write_text("")
    steps = {}
    for label, argv, env in prepare_steps(layout, node_root):
        result = run_bounded(argv, layout.report / f"prepare-{label}.log", PREPARE_STEP_TIMEOUT, env, cwd=layout.app)
        steps[label] = result
        if not bounded_ok(result):
            raise StageStop("FAIL", [f"prepare {label}: {result}"])
    problems = preflight_problems()
    if problems:
        raise StageStop("HOLD", problems)
    chrome = find_chrome(layout.browsers)
    return {"status": "PASS", "label": "public networked prepare", "node_root": node_root,
            "chrome": os.path.relpath(chrome, layout.browsers), "steps": steps}


def write_synthetic_etc(layout):
    uid, gid = os.getuid(), os.getgid()
    (layout.etc / "passwd").write_text(f"qa:x:{uid}:{gid}::/tmp/home:/usr/sbin/nologin\n")
    (layout.etc / "group").write_text(f"qa:x:{gid}:\n")
    (layout.etc / "hosts").write_text("127.0.0.1 localhost\n")


def checked_bwrap(layout, node_root, mode, inner, info_fd):
    argv = build_bwrap_argv(layout, node_root, mode, inner, info_fd)
    problems = bwrap_problems(argv, layout, node_root, mode)
    if problems:
        raise StageStop("FAIL", problems)
    return argv


def run_in_namespace(layout, node_root, mode, inner, info_path, log_name, timeout):
    fd = os.open(info_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        argv = checked_bwrap(layout, node_root, mode, inner, fd)
        # bwrap gets a scrubbed env and then clears it again with --clearenv.
        return run_bounded(argv, layout.report / log_name, timeout, scrubbed_env(), pass_fds=(fd,))
    finally:
        os.close(fd)


def stage_node_root(layout):
    return (read_json(layout.report / "stage-prepare.json") or {}).get("node_root")


def build_body(args, layout):
    require_stages(layout, ["validate", "prepare"])
    problems = wrapper_problems((layout.app / BUILD_WRAPPER).read_text())
    problems += preflight_problems()
    if problems:
        raise StageStop("HOLD", problems)
    expected = read_json(layout.work / "expected-tree.json") or {}
    expected = {k: tuple(v) for k, v in expected.items()}
    problems = stage_tree_problems(str(layout.app), expected)
    if not expected or problems:
        raise StageStop("FAIL", ["stage drifted before build"] + problems[:50])
    write_synthetic_etc(layout)
    inner = [SELF_PYTHON, "-I", f"{NS_HARNESS}/ot-linux-qa.py", "inner-build", "--timeout", str(BUILD_TIMEOUT - 15)]
    result = run_in_namespace(layout, stage_node_root(layout), "build", inner,
                              layout.work / "build-info.json", "bwrap-build.log", BUILD_TIMEOUT)
    inner_report = read_json(layout.report / "inner-build.json") or {}
    if not bounded_ok(result) or inner_report.get("problems") != []:
        raise StageStop("FAIL", [f"namespace build: {result}", *inner_report.get("problems", ["no report"])])
    # next build may rewrite tsconfig.json; nothing else tracked may move.
    problems = build_output_problems(str(layout.app / ".next"))
    problems += stage_tree_problems(str(layout.app), expected, frozenset({"tsconfig.json"}))
    if problems:
        raise StageStop("FAIL", problems[:50])
    return {"status": "PASS", "isolated": True, "offbox": inner_report.get("offbox"),
            "namespace_build": result, "post_build_tree": "matches pin excluding tsconfig.json"}


def create_tripwire(layout):
    nonce = "OT_QA_TRIPWIRE_" + secrets.token_hex(16)
    path = layout.outside / "private-tripwire"
    path.write_text(nonce)
    path.chmod(0o600)
    return path, nonce


def read_bwrap_info(path):
    """bwrap --info-fd JSON; the key names are from its man page, UNVERIFIED on jammy."""
    info = read_json(path)
    return info if isinstance(info, dict) and isinstance(info.get("child-pid"), int) else None


def host_cleanup_problems(info, net_id, proc="/proc", clock=time.monotonic, sleep=time.sleep, wait=5.0):
    """After bwrap exits, nothing may remain in its exact PID or network namespace."""
    if info is None:
        return ["bwrap child pid not recorded"]
    if not net_id:
        return ["namespace id not recorded"]
    end = clock() + wait
    while True:
        holders = namespace_holders(net_id, proc)
        alive = os.path.exists(f"{proc}/{info['child-pid']}")
        if (not holders and not alive) or clock() >= end:
            break
        sleep(POLL)
    problems = [f"process remains in namespace: {pid}" for pid in holders]
    if alive:
        problems.append(f"bwrap child {info['child-pid']} still present")
    return problems


def run_body(args, layout):
    require_stages(layout, ["validate", "prepare", "build"])
    problems = preflight_problems()
    if problems:
        raise StageStop("HOLD", problems)
    node_root = stage_node_root(layout)
    chrome = os.path.join(NS_BROWSERS, os.path.relpath(find_chrome(layout.browsers), layout.browsers))
    (layout.app / ".next/cache").mkdir(exist_ok=True)
    tripwire, nonce = create_tripwire(layout)
    if tripwire.read_text() != nonce:
        raise StageStop("HOLD", ["tripwire positive control failed on host"])
    # Set in this process only: the scrubbed child env must not carry it across.
    os.environ["OT_QA_HOST_CANARY"] = nonce
    canary = nonce
    inner = [SELF_PYTHON, "-I", f"{NS_HARNESS}/ot-linux-qa.py", "inner-run", "--port", str(PORT),
             "--tripwire", str(tripwire), "--canary", canary, "--chrome", chrome]
    info_path = layout.work / "run-info.json"
    result = run_in_namespace(layout, node_root, "runtime", inner, info_path, "bwrap-run.log", RUN_TIMEOUT)
    inner_report = read_json(layout.report / "inner.json")
    net_id = ((inner_report or {}).get("namespace") or {}).get("net")
    host_cleanup = host_cleanup_problems(read_bwrap_info(info_path), net_id)
    if not bounded_ok(result) and (inner_report or {}).get("status") == "PASS":
        host_cleanup.append(f"namespace exit disagrees with inner PASS: {result}")
    tripwire.unlink()
    stages = {n: stage_status(layout, n) for n in ("validate", "prepare", "build")}
    artifact = artifact_report(layout.report, nonce)
    status, final = final_gate(stages, inner_report, host_cleanup, artifact)
    ui = (inner_report or {}).get("ui")
    result_doc = {
        "status": status, "problems": final, "kind": "SYNTHETIC CLIENT RESPONSE browser proof; never backend E2E",
        "pin": PIN, "reached": (inner_report or {}).get("reached"), "namespace_run": result,
        "host_cleanup_problems": host_cleanup, "artifact": artifact,
        "observed_counts": ui.get("counts") if isinstance(ui, dict) else None,
        "tmp_run_bytes_observed": tree_bytes(layout.tmp_run),
    }
    # Last write of the run, after every process and namespace check above.
    write_json(layout.report / "RESULT.json", result_doc)
    return {"status": status, "problems": final}


def seal_body(args, layout):
    existing = read_json(layout.report / "RESULT.json")
    if existing is None:
        stages = {n: stage_status(layout, n) for n in ("validate", "prepare", "build", "run")}
        existing = {"status": "FAIL", "problems": ["run did not complete"], "stages": stages}
        write_json(layout.report / "RESULT.json", existing)
    dropped = enforce_report_cap(layout.report)
    for line in report_excerpt(layout.report):
        print(line, flush=True)
    print_build_failure_excerpt(layout.report)
    print(json.dumps({"status": existing.get("status"), "dropped": dropped}), flush=True)
    return 0 if existing.get("status") == "PASS" and not dropped else 1


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    for name in ("validate", "prepare", "build", "run", "seal"):
        item = sub.add_parser(name)
        item.add_argument("--root", required=True)
        if name == "validate":
            item.add_argument("--repo", required=True)
            item.add_argument("--ref", required=True)
            item.add_argument("--sha", required=True)
        if name == "prepare":
            item.add_argument("--node", required=True)
    item = sub.add_parser("inner-build")
    item.add_argument("--timeout", type=int, required=True)
    item = sub.add_parser("inner-run")
    item.add_argument("--port", type=int, required=True)
    item.add_argument("--tripwire", required=True)
    item.add_argument("--canary", required=True)
    item.add_argument("--chrome", required=True)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.stage == "inner-build":
        return inner_build(args)
    if args.stage == "inner-run":
        return inner_run(args)
    layout = Layout(args.root)
    layout.create()
    if args.stage == "seal":
        return seal_body(args, layout)
    body = {"validate": validate_body, "prepare": prepare_body, "build": build_body, "run": run_body}[args.stage]
    return stage_runner(args.stage, layout, lambda: body(args, layout))


if __name__ == "__main__":
    sys.exit(main())
