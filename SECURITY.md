# Security

## Reporting a vulnerability

Please do not report security problems in public issues. Use GitHub's private reporting instead: on the repository's **Security** tab, choose **Report a vulnerability**. Describe what you found, how to reproduce it and what it lets an attacker do. You will get an answer as soon as possible, and credit in the release that fixes it if you want it.

## Supported versions

Only the newest full release gets fixes. The desktop app updates itself to it (Settings › Advanced › Updates), and the website always runs it.

## What matters most

- **Song files and library backups** (`.soundwave`, `.soundwave-backup`) are read from anywhere, so anything that lets a crafted file do more than fail to open.
- **Updates:** the desktop app only installs releases signed with the project's key. Anything that gets around that check.
- **The desktop app's access** to files and devices beyond what it asks for.
