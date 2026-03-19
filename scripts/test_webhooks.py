#!/usr/bin/env python3
"""
Test script for Beacon CRM webhook endpoints.
Sends realistic sample payloads to each webhook.

Usage:
    python scripts/test_webhooks.py

Requires the stack to be running: docker compose up
"""

import json
import sys
import urllib.error
import urllib.request

BASE_URL = "http://localhost:8000"


def post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            print(f"  ✓  {result}")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ✗  HTTP {e.code}: {body}")
        return {}
    except Exception as e:
        print(f"  ✗  {e}")
        return {}


def test_instantly() -> None:
    print("\n[Instantly] email_opened ─────────────────────────────")
    post(
        "/api/v1/webhooks/instantly",
        {
            "event_type": "email_opened",
            "to_email": "priya@darwinbox.com",
            "subject": "Following up on Beacon.li demo request",
            "opened_at": "2024-01-15T10:30:00Z",
            "campaign_id": "camp_abc123",
        },
    )

    print("\n[Instantly] email_replied ─────────────────────────────")
    post(
        "/api/v1/webhooks/instantly",
        {
            "event_type": "email_replied",
            "to_email": "cto@acme.com",
            "subject": "Re: Beacon.li pilot proposal",
            "reply_text": "Sounds good, let's schedule a call next week.",
        },
    )

    print("\n[Instantly] email_bounced ─────────────────────────────")
    post(
        "/api/v1/webhooks/instantly",
        {
            "event_type": "email_bounced",
            "to_email": "old.contact@legacy.com",
            "subject": "Intro: Beacon.li for enterprise deployment",
            "bounce_type": "hard",
        },
    )


def test_fireflies() -> None:
    print("\n[Fireflies] transcript_ready ──────────────────────────")
    post(
        "/api/v1/webhooks/fireflies",
        {
            "title": "Darwinbox — Discovery Call",
            "duration_minutes": 47,
            "summary": (
                "Discussed Beacon.li's implementation orchestration for a "
                "1,500-person org currently on BambooHR. Key pain point: "
                "6-month DAP rollouts causing low adoption. Budget confirmed for Q2."
            ),
            "ai_summary": (
                "Champion: Priya Sharma (VP Eng). Economic buyer: CFO (not yet engaged). "
                "Next step: technical deep-dive + security review. "
                "Competition: WalkMe in evaluation. Win probability: high."
            ),
            "participants": ["priya@darwinbox.com", "sales@beacon.li"],
            "recorded_at": "2024-01-15T14:00:00Z",
        },
    )


def test_rb2b() -> None:
    print("\n[RB2B] website_visitor ────────────────────────────────")
    post(
        "/api/v1/webhooks/rb2b",
        {
            "name": "John Smith",
            "company_name": "TechCorp Inc",
            "company_domain": "techcorp.com",
            "linkedin_url": "https://linkedin.com/in/johnsmith",
            "pages_visited": ["/pricing", "/enterprise", "/case-studies"],
            "time_on_site_seconds": 312,
            "visited_at": "2024-01-15T16:45:00Z",
        },
    )

    print("\n[RB2B] website_visitor (second) ───────────────────────")
    post(
        "/api/v1/webhooks/rb2b",
        {
            "name": "Aisha Patel",
            "company_name": "GlobalHR Solutions",
            "company_domain": "globalhr.io",
            "pages_visited": ["/product", "/pricing"],
            "visited_at": "2024-01-15T17:10:00Z",
        },
    )


def main() -> None:
    print(f"Beacon CRM — Webhook Test\nTarget: {BASE_URL}\n{'─' * 50}")

    # Quick health check
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as r:
            print(f"API health: {json.loads(r.read())['status']}")
    except Exception:
        print("ERROR: API is not reachable. Is `docker compose up` running?")
        sys.exit(1)

    test_instantly()
    test_fireflies()
    test_rb2b()

    print(f"\n{'─' * 50}")
    print(f"Done! View activities at: {BASE_URL}/api/v1/activities/")
    print(f"Swagger UI:               {BASE_URL}/docs")


if __name__ == "__main__":
    main()
