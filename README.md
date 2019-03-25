# Multifactor.io Alpha

## What is this?
Small proof-of-concept of a multi-factor authentication framework. That is, require multiple people to authorize a user action with 2FA.

## What do you need?
1. `npm install`
1. Create .env file:

 ```
TWILIO_ACCOUNT_SID={your_twilio_account_sid}
TWILIO_AUTH_TOKEN={your_twilio_auth_token}
TWILIO_FROM={your_twilio_from_telephone_number}
PORT={an_open_port}
```

1. Change `contacts.push()` with your `to:` number; you can add multiples, but beware of outbound SMS token usage.
1. `npm run start`
1. Launch the browser where the app is living at `/` to generate a new auth request; your recipient list will receive SMS messages with the URL to authorize the request. By default, number of requests until successful is `3`.

## Copyright
(c) 2019 James Robert Perih. Not licensed for any use.