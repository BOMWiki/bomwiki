-- User pages: a self-authored markdown page on the profile, wiki-style.
-- Same pipeline as articles (markdown, [[wiki-links]], sanitized), so a
-- profile can read like a resume: who they are, what they know, which
-- pages they care about.

alter table users add column profile_md text;
