# -*- coding: utf-8 -*-
import json, urllib.request, subprocess, sys

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

head = "0be2a4b62396819bc3a3fe100163463af6fdbc17"
target_wf = sys.argv[1]
target_step = sys.argv[2]
req = urllib.request.Request(f"https://api.github.com/repos/Paige-Agent-AI/Paige-Agent-AI/actions/runs?head_sha={head}&per_page=100", headers=headers)
with urllib.request.urlopen(req) as resp: runs = json.load(resp)["workflow_runs"]
run = next((r for r in runs if r["name"] == target_wf), None)
if not run:
    print("no run for", target_wf); raise SystemExit(1)
req = urllib.request.Request(f"https://api.github.com/repos/Paige-Agent-AI/Paige-Agent-AI/actions/runs/{run['id']}/jobs?per_page=50", headers=headers)
with urllib.request.urlopen(req) as resp: jobs = json.load(resp)["jobs"]
for j in jobs:
    if j["conclusion"] == "failure":
        log = job_log(j["id"])
        lines = log.splitlines()
        # find the group header for the target step, print until the next group
        start = next((i for i, l in enumerate(lines) if target_step in l), None)
        if start is None:
            continue
        end = next((k for k in range(start + 1, min(start + 600, len(lines))) if "##[group]" in lines[k]), start + 600)
        block = lines[start:min(end, start + 400)]
        # trim to the interesting tail
        print("\n".join(block[-90:]))
