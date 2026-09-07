#!/usr/bin/env python3
"""Bundle index.html + src/*.js into single self-contained files.

    python3 build.py

Writes:
  dist/amazing-race.html   full standalone page — works from file://, any static host
  dist/artifact.html       same page without the <!doctype>/<html>/<head>/<body>
                           wrapper, for hosts that supply their own document shell
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")

html = open(os.path.join(HERE, "index.html")).read()


def inline(match):
    src = match.group(1)
    path = os.path.join(HERE, src)
    if not os.path.exists(path):
        raise SystemExit("build: missing %s" % src)
    code = open(path).read()
    return "<script>\n/* ---- %s ---- */\n%s</script>" % (src, code)


bundled = re.sub(r'<script src="([^"]+)"></script>', inline, html)
if '<script src="' in bundled:
    raise SystemExit("build: some scripts were not inlined")

os.makedirs(DIST, exist_ok=True)

standalone = os.path.join(DIST, "amazing-race.html")
open(standalone, "w").write(bundled)

# Strip the document wrapper: keep <title> + <style> from the head, and the body's
# contents. Hosts that inject their own <head>/<body> want exactly this.
head = re.search(r"<head>(.*?)</head>", bundled, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", bundled, re.S).group(1)
keep = "\n".join(
    m.group(0) for m in re.finditer(r"<title>.*?</title>|<style>.*?</style>", head, re.S)
)
fragment = os.path.join(DIST, "artifact.html")
open(fragment, "w").write(keep.strip() + "\n" + body.strip() + "\n")

for f in (standalone, fragment):
    print("%-34s %6.1f KB" % (os.path.relpath(f, HERE), os.path.getsize(f) / 1024))
