# Shorter, cheaper SMS + full details on WhatsApp after "Hi"

WhatsApp texts, message limits, WhatsApp/SMS routing and all screens stay unchanged.

## Part 1: SMS helpers (new pure module `src/lib/sms-format.ts`)
- `smsClean(text)`: long/en dash to "-", curly quotes to straight, "…" to "...", "|" to ","; strip any other non-ASCII character.
- `smsFirstName` (first word, max 10), `smsDate` ("Sun 8 Nov", India date, no year), `smsTime` ("4:30PM"), `smsDoctor` ("Dr " + name with no leading Dr/Dr., max 14, empty if no doctor), `smsClinic` (max 18).
- `fitSms(build)`: if the text is over 134 characters, shorten in this order until it fits: clinic to 12, doctor to 8, first name to 6. The WhatsApp link and date/time are never cut.
- Empty parts (such as no doctor) are left out cleanly.

## Part 2: New SMS texts (SMS branch of `dispatchNotification` only)
- confirmation: `{first}: appt {date} {time}, {doctor}, {clinic}. Updates: send Hi {W}`. With no clinic mobile it ends with ` -ClinicQ`. No map, address, token note or disclaimer.
- reminder_24h: `{first}: reminder, appt tomorrow {date} {time}, {doctor}, {clinic}. -ClinicQ`
- rescheduled: `{first}: appt moved to {date} {time}, {doctor}, {clinic}. -ClinicQ`
- shift_update: `{first}: {doctor} running about {N} min late. New time {time}. -ClinicQ`, or `{first}: {doctor} is back on schedule. Time {time}. -ClinicQ`
- doctor_arrived: `{first}: {doctor} has arrived at {clinic}. -ClinicQ`
- next_in_line: `{first}: you are next with {doctor}. Please be ready. -ClinicQ`
- reported / queue_update: `{first}: Token #{N}, time {time}, {doctor}. -ClinicQ` (time left out if missing; N = same rank as the dashboard)
- default: `{first}: update from {clinic}. -ClinicQ`
- Every SMS goes through `fitSms` and then `smsClean` before it is sent.

## Part 3: Full details on WhatsApp after the first "Hi"
In `src/routes/api/public/hooks/whatsapp-optin.ts`:
- Before the upsert, check whether an opt-in row already exists for this clinic and phone.
- If it is a new opt-in, find the patient's nearest upcoming waiting token at this clinic (today or later in India time, same last 10 digits, earliest first) and send the normal `confirmation` through `dispatchNotification` with the admin client. It goes out on WhatsApp with the full details.
- If the send fails, log it and still return ok. A repeat "Hi" sends nothing.

## Tests
`tests/sms-format.test.ts`: cleaning special characters, the date/time/doctor formats, the example confirmation text, the 134-character fitting order, and that the link is never cut.
