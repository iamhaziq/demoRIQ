from retailiq_ml.alerts import RESEND_URL, batch_report, send_alert


def test_send_alert_posts_to_resend(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("ALERT_EMAIL", "owner@example.com")
    sent = []
    ok = send_alert("Nightly prediction failed", ["- shop a: boom"], post=lambda u, h, b: sent.append((u, h, b)) or 200)
    assert ok
    url, headers, body = sent[0]
    assert url == RESEND_URL and headers["Authorization"] == "Bearer re_test"
    assert body["to"] == ["owner@example.com"] and body["subject"] == "[RetailIQ] Nightly prediction failed"
    assert body["text"] == "- shop a: boom"


def test_send_alert_without_secret_does_not_send(monkeypatch, capsys):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert not send_alert("x", ["y"], post=lambda *a: 1 / 0)
    assert "alert not sent" in capsys.readouterr().out


def test_send_alert_never_raises(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "k")
    monkeypatch.setenv("ALERT_EMAIL", "e@x.my")

    def down(*_):
        raise TimeoutError("resend down")

    assert send_alert("x", ["y"], post=down) is False


def test_batch_report_lists_only_failures():
    assert batch_report("Nightly prediction", ["a", "b"], [{"ok": 1}, {"ok": 2}]) is None
    subject, lines = batch_report("Nightly prediction", ["a", "b", "c"], [{"ok": 1}, ValueError("bad data"), {}])
    assert subject == "Nightly prediction failed for 1 shop(s)"
    assert lines[0] == "Nightly prediction: 1 of 3 shops failed."
    assert lines[1] == "- shop b: ValueError: bad data"
