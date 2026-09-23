import httpx
import pytest

from app.digest.telegram import MAX_MESSAGE_LENGTH, list_recent_channels, send_digest, split_message


def test_split_preserves_short_paragraphs():
    text = "第一段\n\n第二段"
    assert split_message(text) == [text]
    assert all(len(part) <= MAX_MESSAGE_LENGTH for part in split_message("a" * 5000))


@pytest.mark.asyncio
async def test_summary_is_silent_and_alert_notifies():
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"ok": True, "result": {"message_id": len(sent)}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await send_digest("有新文章：重點一", "# 完整摘要", "secret-token", "@mychannel", client)
    assert len(sent) == 2
    assert sent[0].read().decode().find('"disable_notification":true') >= 0
    assert sent[1].read().decode().find('"disable_notification":false') >= 0


@pytest.mark.asyncio
async def test_missing_credentials_do_not_send():
    with pytest.raises(ValueError, match="TELEGRAM_BOT_TOKEN"):
        await send_digest("alert", "summary", "", "", None)


@pytest.mark.asyncio
async def test_private_channel_id_can_be_discovered():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True, "result": [
            {"channel_post": {"chat": {"type": "channel", "title": "My Digest", "id": -100123}}},
            {"my_chat_member": {"chat": {"type": "channel", "title": "Second", "id": -100456}, "new_chat_member": {"status": "administrator"}}},
        ]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await list_recent_channels("secret-token", client) == [("My Digest", -100123), ("Second", -100456)]
