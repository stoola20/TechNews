ALTER TABLE articles ADD COLUMN content TEXT;
ALTER TABLE articles ADD COLUMN content_method TEXT;
ALTER TABLE articles ADD COLUMN model_provider TEXT;
ALTER TABLE articles ADD COLUMN model_name TEXT;
ALTER TABLE articles ADD COLUMN last_error TEXT;

-- Claude moved its blog articles. Preserve already-notified identities.
UPDATE OR IGNORE articles SET source_url = replace(source_url, 'https://claude.com/blog/', 'https://claude.com/resources/articles/')
WHERE source = 'claude_blog' AND source_url LIKE 'https://claude.com/blog/%';
UPDATE source_state SET seen_urls_json = replace(seen_urls_json, 'https://claude.com/blog/', 'https://claude.com/resources/articles/')
WHERE source = 'claude_blog';
