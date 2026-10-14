"""Exercise the real Message Board UI in two independent browser contexts."""

import argparse
import json
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


def post(page, username: str, message: str) -> None:
    page.get_by_role("textbox", name="Username").fill(username)
    page.get_by_role("textbox", name="Message").fill(message)
    page.get_by_role("button", name="Post message").click()
    expect(page.get_by_role("button", name="Post message")).to_be_enabled(timeout=15000)


def visible(page, username: str, message: str) -> None:
    row = page.get_by_role("list", name="Messages").get_by_role("listitem").filter(
        has_text=message
    )
    expect(row).to_have_count(1, timeout=20000)
    expect(row).to_contain_text(username)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    run_id = uuid4().hex
    issues: list[dict[str, str]] = []
    result: dict[str, object] = {"runId": run_id, "url": args.url, "status": "FAIL"}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            contexts = [browser.new_context(), browser.new_context()]
            pages = [context.new_page() for context in contexts]
            for page in pages:
                page.on("pageerror", lambda error: issues.append({"kind": "pageerror", "text": str(error)}))
                page.on(
                    "console",
                    lambda message: issues.append({"kind": "console", "text": message.text})
                    if message.type == "error"
                    else None,
                )
                page.on(
                    "requestfailed",
                    lambda request: issues.append(
                        {"kind": "requestfailed", "text": f"{request.method} {request.url}"}
                    ),
                )
                page.goto(args.url, wait_until="domcontentloaded", timeout=15000)
                expect(page.get_by_role("heading", name="Message Board")).to_be_visible(timeout=15000)
                expect(page.get_by_role("status")).to_contain_text("Updating live", timeout=15000)

            first_user, first_text = f"ui-a-{run_id[:8]}", f"first-{run_id}"
            second_user, second_text = f"ui-b-{run_id[:8]}", f"second-{run_id}"
            post(pages[0], first_user, first_text)
            visible(pages[0], first_user, first_text)
            visible(pages[1], first_user, first_text)
            post(pages[1], second_user, second_text)
            visible(pages[1], second_user, second_text)
            visible(pages[0], second_user, second_text)
            for page in pages:
                expect(page.get_by_role("status")).to_contain_text("Updating live")
            if issues:
                raise AssertionError(f"browser errors: {issues}")
            for index, page in enumerate(pages):
                page.screenshot(path=str(args.output / f"context-{index}.png"), full_page=True)
            result.update(
                status="PASS",
                posts=[{"username": first_user, "text": first_text},
                       {"username": second_user, "text": second_text}],
                contextUrls=[page.url for page in pages],
            )
        except Exception as error:
            result["error"] = str(error)
            raise
        finally:
            result["issues"] = issues
            (args.output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
            browser.close()


if __name__ == "__main__":
    main()
