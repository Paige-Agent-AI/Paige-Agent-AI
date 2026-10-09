# -*- coding: utf-8 -*-
import json, urllib.request, subprocess

def token():
    r = subprocess.run(["git","credential","fill"], input="protocol=https\nhost=github.com\n\n", capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith("password="): return line.split("=",1)[1]

t = token()
headers = {"Authorization": "bearer " + t, "Accept": "application/vnd.github+json"}

class NR(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        return None

onr = urllib.request.build_opener(NR)
opl = urllib.request.build_opener()

def job_log(job_id):
    req = urllib.request.Request(f"https://api.github.com/repos/Paige-Agent-AI/Paige-Agent-AI/actions/jobs/{job_id}/logs", headers=headers)
    try:
        resp = onr.open(req)
        url = resp.headers.get("Location") or resp.geturl()
    except urllib.error.HTTPError as e:
        url = e.headers.get("Location")
    with opl.open(url) as resp:
        return resp.read().decode("utf-8", "replace")

def interesting(l):
    return "##[error]" in l or "not ok" in l or "AssertionError" in l or "ERROR:" in l or " FAIL " in l or "FAIL " in l

head = "0be2a4b62396819bc3a3fe100163463af6fdbc17"
req = urllib.request.Request(f"https://api.github.com/repos/Paige-Agent-AI/Paige-Agent-AI/actions/runs?head_sha={head}&per_page=100", headers=headers)
with urllib.request.urlopen(req) as resp: runs = json.load(resp)["workflow_runs"]
for run in runs:
    if run["conclusion"] != "failure": continue
    req = urllib.request.Request(f"https://api.github.com/repos/Paige-Agent-AI/Paige-Agent-AI/actions/runs/{run['id']}/jobs?per_page=50", headers=headers)
    with urllib.request.urlopen(req) as resp: jobs = json.load(resp)["jobs"]
    for j in jobs:
        if j["conclusion"] == "failure":
            failed_steps = [s["name"] for s in j["steps"] if s["conclusion"] == "failure"]
            print("=" * 12, run["name"], "/", j["name"], "=" * 12)
            print("FAILED STEPS:", failed_steps)
            log = job_log(j["id"])
            lines = log.splitlines()
            shown = set()
            blocks = 0
            for i, l in enumerate(lines):
                if interesting(l):
                    key = i // 30
                    if key in shown: continue
                    shown.add(key)
                    print("\n".join(lines[max(0, i - 6):i + 10]))
                    print("-" * 25)
                    blocks += 1
                    if blocks >= 3: break
