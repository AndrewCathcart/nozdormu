# nozdormu

Currently a work in progress.

[Discord](https://discordapp.com/) is a free voice, text & video chat app for gaming communities.

This project is a bot I've built using [discord.js](https://discord.js.org/#/) and the [Google Sheets API](https://developers.google.com/sheets/api) in order to simplify the management of around 50+ individuals in a community I'm part of. Previously we'd make a post in a channel specifying a few dates and asking people to reply to it if they can't attend any. We'd then need to read all the replies, check dates, and make a mental note. This bot removes all those tedious steps and room for error whilst providing timestamped logs and ease of use.

Functionality includes;

- Creation and removal of calendar event posts to a specific channel.
- Automatic creation and removal of these events as columns in Google Sheets.
- Logs who will be attending the event based on reactions (✅, ❌ or no reaction at all) as rows in Google Sheets (using their Discord name).
- Logs include a timestamp incase people change their mind on the day (short notice is pretty much no notice).
