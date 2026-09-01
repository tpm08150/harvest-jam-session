#!/usr/bin/env python3
"""Mirror the Hub's Firestore allowlist into Supabase's jam_members.

    python3 tools/sync-allowlist.py > /tmp/jam-members.sql

Then paste that file into the Supabase SQL editor and run it.

⚠️ IT PRINTS TO STDOUT AND WRITES NOTHING. The output is a list of your colleagues' email
   addresses and this repo is on GitHub — so the script refuses to choose a path inside it.
   Redirect somewhere outside the repo, run it, delete it.

⚠️ IT IS A MIRROR, NOT AN APPEND. The SQL deletes anybody who is no longer on the Hub's
   allowlist as well as adding whoever is new — otherwise somebody who left the company
   keeps their key to the tape shelf, which is the failure nobody notices because nothing
   visibly breaks.

WHY THIS IS A SCRIPT AND NOT A CRON. Automating it needs somewhere server-side to run and
Supabase's service_role key parked in Netlify — a credential that bypasses every RLS policy
protecting the recordings. That is a large new risk to avoid re-running one command a few
times a year. Revisit if the list ever starts changing weekly.
"""
import json, sys, time, urllib.request, urllib.parse

KEY = "/Users/tylers-laptop/dev/hmx-pm-toolbox-firebase-adminsdk-fbsvc-682edec753.json"

def token(sa):
    import jwt
    now = int(time.time())
    a = jwt.encode({"iss": sa["client_email"],
                    "scope": "https://www.googleapis.com/auth/datastore",
                    "aud": "https://oauth2.googleapis.com/token",
                    "iat": now, "exp": now + 3600},
                   sa["private_key"], algorithm="RS256")
    r = urllib.request.Request("https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": a}).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(r))["access_token"]

def allowlist(sa, tok):
    base = ("https://firestore.googleapis.com/v1/projects/%s/databases/(default)"
            "/documents/allowlist" % sa["project_id"])
    out, page = [], None
    while True:
        url = base + "?pageSize=300" + ("&pageToken=" + page if page else "")
        r = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})
        d = json.load(urllib.request.urlopen(r))
        out += d.get("documents", [])
        page = d.get("nextPageToken")
        if not page:
            return sorted({x["name"].rsplit("/", 1)[-1].strip().lower()
                           for x in out if x.get("name")})

def main():
    try:
        sa = json.load(open(KEY))
    except OSError:
        sys.exit("Cannot read the Firebase admin key at:\n  " + KEY)
    emails = allowlist(sa, token(sa))
    if not emails:
        sys.exit("The allowlist came back empty — refusing to emit SQL that would "
                 "delete every member.")
    q = lambda e: "'" + e.replace("'", "''") + "'"
    keep = ",\n  ".join(q(e) for e in emails)
    add = ",\n  ".join("(%s, 'from the Hub allowlist')" % q(e) for e in emails)
    print("-- Mirror of the Hub's Firestore allowlist. %d addresses, generated %s."
          % (len(emails), time.strftime("%Y-%m-%d %H:%M")))
    print("-- Paste into the Supabase SQL editor. Do NOT commit this output.\n")
    print("begin;\n")
    print("-- anyone no longer on the Hub's list loses access here too")
    print("delete from public.jam_members where email not in (\n  %s\n);\n" % keep)
    print("insert into public.jam_members (email, note) values\n  %s" % add)
    print("on conflict (email) do nothing;\n")
    print("commit;\n")
    print("-- select count(*) from public.jam_members;   -- expect %d" % len(emails))

main()
