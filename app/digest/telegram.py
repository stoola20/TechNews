"""Send a silent archive copy and a short alert to a Telegram channel."""

import argparse
import asyncio
from pathlib import Path

import httpx

from app.core.config import get_settings

MAX_MESSAGE_LENGTH = 4096


def split_message(text: str) -> list[str]:
    """Split on paragraph boundaries when possible, preserving all text."""
    if not text.strip():
        raise ValueError("Telegram message must not be empty")
    parts: list[str] = []
    current = ""
    for paragraph in text.strip().split("\n\n"):
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= MAX_MESSAGE_LENGTH:
            current = candidate
            continue
        if current:
            parts.append(current)
            current = ""
        while len(paragraph) > MAX_MESSAGE_LENGTH:
            parts.append(paragraph[:MAX_MESSAGE_LENGTH])
            paragraph = paragraph[MAX_MESSAGE_LENGTH:]
        current = paragraph
    if current:
        parts.append(current)
    return parts


async def send_digest(
    alert_text: str,
    summary_text: str,
    bot_token: str,
    chat_id: str,
    client: httpx.AsyncClient | None = None,
) -> None:
    if not bot_token or not chat_id:
        raise ValueError("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
    if not alert_text.strip() or len(alert_text) > MAX_MESSAGE_LENGTH:
        raise ValueError("Telegram alert must contain 1–4096 characters")

    async def post(http_client: httpx.AsyncClient, text: str, silent: bool) -> None:
        try:
            response = await http_client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "disable_notification": silent,
                    "link_preview_options": {"is_disabled": True},
                },
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            # httpx exceptions can include the token-bearing URL.
            raise RuntimeError("Telegram request failed; check bot permissions and channel ID") from None
        if not payload.get("ok"):
            raise RuntimeError("Telegram rejected the message; check bot permissions and channel ID")

    async def send_all(http_client: httpx.AsyncClient) -> None:
        for part in split_message(summary_text):
            await post(http_client, part, silent=True)
        await post(http_client, alert_text, silent=False)

    if client is not None:
        await send_all(client)
    else:
        async with httpx.AsyncClient(timeout=20) as http_client:
            await send_all(http_client)


async def list_recent_channels(bot_token: str, client: httpx.AsyncClient | None = None) -> list[tuple[str, int]]:
    """Find private channel IDs from recent posts visible to this bot."""
    if not bot_token:
        raise ValueError("Set TELEGRAM_BOT_TOKEN in .env")

    async def fetch(http_client: httpx.AsyncClient) -> list[tuple[str, int]]:
        try:
            response = await http_client.get(f"https://api.telegram.org/bot{bot_token}/getUpdates")
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise RuntimeError("Telegram request failed; check the bot token") from None
        if not payload.get("ok"):
            raise RuntimeError("Telegram rejected the request; check the bot token")
        channels = set()
        for update in payload.get("result", []):
            for kind in ("channel_post", "edited_channel_post", "my_chat_member"):
                event = update.get(kind) or {}
                chat = event.get("chat") or {}
                if chat.get("type") != "channel":
                    continue
                if kind == "my_chat_member" and event.get("new_chat_member", {}).get("status") not in {"member", "administrator", "creator"}:
                    continue
                channels.add((chat.get("title", "未命名頻道"), chat["id"]))
        return sorted(channels)

    if client is not None:
        return await fetch(client)
    async with httpx.AsyncClient(timeout=20) as http_client:
        return await fetch(http_client)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a Developer Digest to Telegram")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--alert-file", type=Path)
    group.add_argument("--list-chats", action="store_true")
    group.add_argument("--test", action="store_true")
    parser.add_argument("--summary-file", type=Path)
    args = parser.parse_args()
    settings = get_settings()
    if args.list_chats:
        channels = asyncio.run(list_recent_channels(settings.telegram_bot_token))
        for title, chat_id in channels:
            print(f"{title}: {chat_id}")
        if not channels:
            print("找不到頻道；請到頻道資訊的管理員名單確認 bot 已加入，再貼一則新訊息。只在貼文提及 @bot 不會把它加入頻道。")
        return
    if args.test:
        asyncio.run(send_digest("Developer Digest 通知測試：Telegram 已連線。", "Developer Digest 完整摘要測試：之後新文章會先以靜音訊息保存完整摘要，再發送重點通知。", settings.telegram_bot_token, settings.telegram_chat_id))
        return
    if args.summary_file is None:
        parser.error("--alert-file requires --summary-file")
    asyncio.run(
        send_digest(
            args.alert_file.read_text(encoding="utf-8"),
            args.summary_file.read_text(encoding="utf-8"),
            settings.telegram_bot_token,
            settings.telegram_chat_id,
        )
    )


if __name__ == "__main__":
    main()
