# Data safety (Google) and App Privacy (Apple): the answers

Taken from the code and from /privacy. If either changes, change this file in the same pull request.

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: yes. Shares with third parties: **no**. Service providers (Supabase, Vercel) process data on our behalf and do not count as sharing. |
| Encrypted in transit? | Yes (HTTPS only). |
| Can users request deletion? | Yes: in the app (Settings → מחיקת החשבון שלי), and by email to beerdeals.app@gmail.com. |
| Personal info: name | Collected, optional. Used for app functionality only (the greeting). Not linked to identity: no email or phone is ever asked for. |
| Location: approximate | Collected, optional (a town). Used for app functionality: distance to branches. |
| Location: precise | Collected, optional (only if the person taps "use my location"; stored at 4 decimals). Used for app functionality. |
| Photos | Collected, optional: a photo attached to a submitted deal. Used for app functionality (moderation and display). |
| App activity: other user-generated content | Submitted deals, reports such as "the deal ended", followed beers, and a public credit name if chosen. Used for app functionality. |
| Device or other IDs | A push subscription endpoint, if notifications are on. Used for app functionality (notifications). |
| Analytics, advertising, tracking | **None.** There is no analytics SDK, no ads, and no cross-app tracking. Apple's "Data Used to Track You" is empty. |
| Account | Created automatically and anonymously. There is no login, so no "sign-in data". |
