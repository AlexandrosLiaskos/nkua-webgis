"""Checks of the files in the repository.

The checks cover every tracked file of these kinds:

- JSON files (``*.json``, ``*.webmanifest``, ``*.map``) must parse.
- HTML files must be well formed: every element that HTML does not allow to
  stay open is closed, in the order in which it was opened.
- Python files must compile.
- Shell scripts must pass ``bash -n``.

Run from the root of the repository: ``python3 tools/checks/check_files.py``.
"""

from __future__ import annotations

import json
import subprocess
import sys
from html.parser import HTMLParser

# Elements without content: they have no end tag.
VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
}
# Elements whose end tag HTML allows to be left out.
OPTIONAL_END = {
    "html", "head", "body", "p", "li", "dt", "dd", "option", "optgroup", "tr",
    "td", "th", "thead", "tbody", "tfoot", "colgroup", "caption", "rb", "rt",
    "rtc", "rp",
}
# Start tags that end an open paragraph.
CLOSES_P = {
    "address", "article", "aside", "blockquote", "details", "dialog", "div",
    "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav",
    "ol", "p", "pre", "section", "table", "ul",
}
# For a start tag: the open elements that it ends, and the elements at which
# the search for them stops.
IMPLIED_END = {
    "li": ({"li"}, {"ul", "ol", "menu"}),
    "dt": ({"dt", "dd"}, {"dl"}),
    "dd": ({"dt", "dd"}, {"dl"}),
    "tr": ({"tr"}, {"table", "thead", "tbody", "tfoot"}),
    "td": ({"td", "th"}, {"tr", "table"}),
    "th": ({"td", "th"}, {"tr", "table"}),
    "thead": ({"thead", "tbody", "tfoot"}, {"table"}),
    "tbody": ({"thead", "tbody", "tfoot"}, {"table"}),
    "tfoot": ({"thead", "tbody", "tfoot"}, {"table"}),
    "option": ({"option"}, {"select", "datalist", "optgroup"}),
    "optgroup": ({"option", "optgroup"}, {"select"}),
}
FOREIGN = {"svg", "math"}


class WellFormed(HTMLParser):
    """Record the elements that are not closed, or closed out of order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.errors: list[str] = []

    def line(self) -> int:
        return self.getpos()[0]

    def in_foreign(self) -> bool:
        return any(tag in FOREIGN for tag, _ in self.stack)

    def end_implied(self, tag: str) -> None:
        if self.in_foreign():
            return
        if tag in CLOSES_P and self.stack and self.stack[-1][0] == "p":
            self.stack.pop()
        if tag not in IMPLIED_END:
            return
        ended, stops = IMPLIED_END[tag]
        for position in range(len(self.stack) - 1, -1, -1):
            name = self.stack[position][0]
            if name in stops:
                return
            if name in ended:
                for inner, opened in self.stack[position + 1:]:
                    if inner not in OPTIONAL_END:
                        self.errors.append(
                            f"line {self.line()}: <{inner}> opened on line {opened} "
                            f"is not closed before <{tag}>"
                        )
                del self.stack[position:]
                return

    def handle_starttag(self, tag: str, attrs: list) -> None:
        self.end_implied(tag)
        if tag not in VOID:
            self.stack.append((tag, self.line()))

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        if tag in VOID or self.in_foreign():
            self.end_implied(tag)
            return
        self.errors.append(
            f"line {self.line()}: <{tag}/> is not a void element and stays open in HTML"
        )
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID:
            self.errors.append(f"line {self.line()}: </{tag}> closes a void element")
            return
        names = [name for name, _ in self.stack]
        if tag not in names:
            if tag != "p":
                self.errors.append(f"line {self.line()}: </{tag}> has no open <{tag}>")
            else:
                self.errors.append(f"line {self.line()}: </p> has no open <p>")
            return
        while self.stack:
            name, opened = self.stack.pop()
            if name == tag:
                break
            if name not in OPTIONAL_END:
                self.errors.append(
                    f"line {self.line()}: <{name}> opened on line {opened} "
                    f"is not closed before </{tag}>"
                )

    def finish(self) -> list[str]:
        self.close()
        for name, opened in self.stack:
            if name not in OPTIONAL_END:
                self.errors.append(f"<{name}> opened on line {opened} is never closed")
        return self.errors


def tracked(*patterns: str) -> list[str]:
    """Return the tracked files that match the patterns."""
    output = subprocess.run(
        ["git", "ls-files", "-z", "--", *patterns], check=True, capture_output=True
    ).stdout
    return [name.decode("utf-8") for name in output.split(b"\0") if name]


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def check_json(path: str) -> list[str]:
    try:
        json.loads(read_text(path))
    except (ValueError, UnicodeDecodeError) as error:
        return [str(error)]
    return []


def check_html(path: str) -> list[str]:
    try:
        parser = WellFormed()
        parser.feed(read_text(path))
        return parser.finish()
    except UnicodeDecodeError as error:
        return [str(error)]


def check_python(path: str) -> list[str]:
    try:
        compile(read_text(path), path, "exec")
    except (SyntaxError, UnicodeDecodeError) as error:
        return [str(error)]
    return []


def check_shell(path: str) -> list[str]:
    result = subprocess.run(["bash", "-n", path], capture_output=True, text=True)
    return [result.stderr.strip()] if result.returncode else []


CHECKS = [
    ("JSON", ("*.json", "*.webmanifest", "*.map"), check_json),
    ("HTML", ("*.html", "*.htm"), check_html),
    ("Python", ("*.py",), check_python),
    ("Shell", ("*.sh",), check_shell),
]


def main() -> int:
    failures = 0
    for kind, patterns, check in CHECKS:
        files = tracked(*patterns)
        failed = 0
        for path in files:
            errors = check(path)
            if errors:
                failed += 1
                print(f"FAIL {kind} {path}")
                for error in errors:
                    print(f"  {error}")
        print(f"{kind}: {len(files) - failed} of {len(files)} files pass.")
        failures += failed
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
