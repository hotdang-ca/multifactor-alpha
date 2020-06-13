const app = require('express')();

const http = require('http').Server(app);
const address = http.address();

const io = require('socket.io')(http);
const uuidv1 = require('uuid/v1');

const Twilio = require('twilio');
const MessagingResponse = require('twilio').twiml.MessagingResponse;

const config = require('dotenv').config();

// setup mailgun
const mailgun = require("mailgun-js");
const MG_DOMAIN = process.env.MAILGUN_DOMAIN;
const MG_APIKEY = process.env.MAILGUN_API_KEY;
const MG_FROM = process.env.MAILGUN_FROM_ADDRESS;

const mg = mailgun({apiKey: MG_APIKEY, domain: MG_DOMAIN});

// setup bodyParser
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_FROM;

if (!twilioAccountSid || !twilioAuthToken) {
  console.log('No twilio configuration.');
  return;
}

const twilio = new Twilio(twilioAccountSid, twilioAuthToken);

const PORT = process.env.PORT || 3002;
const redirects = [];

const contacts = {};
// {
//   authkey: [
//     {
//       to: '+13065809501',
//     },
//     {
//       to: '+13065809501',
//     }
//   ],
// }

const DEFAULT_NUM_AUTHS = 3;

const authDict = {};

app.get('/', (req, res) => {
  // generate a new uuid
  res.sendFile(`${__dirname}/html/index.html`);
});

// TODO: set up webhook to listen to incoming sms
app.post('/api/webhooks/incoming-sms', (req, res) => {
  const sms = req.body.From;
  const smsBody = req.body.Body;

  const cleanNumber = (number) => number.replace('+', '').replace('-', '');

  const cleanIncomingSms = cleanNumber(sms);
  const redirector = redirects.find((r) => cleanNumber(r.fromSms) === cleanIncomingSms);

  if (!redirector) {
    return res.status(404).json({error: 'not found'});
  }

  const toEmail = redirector.toEmail;

  const data = {
    from: `Manyfactor.io <${MG_FROM}>`,
    to: toEmail,
    subject: 'ManyFactor.io redirected your SMS Authentication',
    text: smsBody,
  };
  mg.messages().send(data, function (error, body) {
    console.log(body);

    const webhookResponse = new MessagingResponse();
    res.end(webhookResponse.toString());
  });
});

app.get('/setup-redirect', (req, res) => {
  res.sendFile(`${__dirname}/html/redirect.html`);
});

app.get('/api/redirect-rules', (req, res) => {
  res.send(JSON.stringify(redirects));
});

app.post('/api/redirect-rules', (req, res) => {
  const { fromSms, toEmail } = req.body;
  redirects.push({
    fromSms,
    toEmail,
  });

  return res.status(204).json({});
});

app.post('/add-authorizers', (req, res) => {
  if (!req.body) {
    return res.status(400).send(JSON.stringify({
      status: 'failed to add; malformed request',
    }));
  }

  const { contact, uuid } = req.body;

  if (!contact || !contact.to || !uuid) {
    return res.status(400).send(JSON.stringify({
      status: 'failed to add; required parameters missing.',
    }));
  }

  if (!contacts[uuid]) {
    contacts[uuid] = [];
  }

  contacts[uuid].push(contact);

  res.send(JSON.stringify(
    {
      status: `Added ${contact.to}. ${contacts[uuid].length} contacts to notify.`,
      contacts: contacts[uuid],
    }
  ));
});

app.get('/authorize/:uuid', (req, res) => {
  res.sendFile(`${__dirname}/html/uuid_auth.html`);
});

io.on('connection', (socket) => {
  socket.on('require-auth', () => {
    uuid = uuidv1();
    numAuthorizations = 0;

    authDict[uuid] = numAuthorizations;

    console.log(`new auth for ${uuid}`);
    const payload = {
      uuid,
      required: DEFAULT_NUM_AUTHS,
    };

    socket.emit('got-uuid', JSON.stringify(payload));
  });

  socket.on('get-auth', (payload) => {
    console.log('Get-Auth Button pressed. Payload: ', payload);
    console.log('contacts', contacts);
    console.log('jsonified payload', JSON.parse(payload));

    try {
      const payloadObject = JSON.parse(payload);
      const { auth } = payloadObject;

      contacts[auth].forEach((recipient) => {
        const messageBody = {
          from: twilioFrom,
          to: recipient.to,
          body: `MANYFACTOR.IO requires your authorization. https://manyfactor.io/authorize/${uuid}. DO NOT REPLY`,
        };

        console.log('body:', messageBody);

        twilio.messages.create(messageBody, (err, result) => {
          if (err) {
            console.log('Twilio error:', err);
            return;
          }
          console.log(`Twilio result: ${result.sid}`);
        });
      });

      socket.emit('auths-sent');
    } catch (e) {
      console.log('couldnt interpret the payload.');
      socket.emit('auths-failed');
    }
  });

  socket.on('give-auth', (payload) => {
    const payloadObject = JSON.parse(payload);
    if (!payloadObject) {
      console.log('No payload Object');
      return;
    }

    if (!payloadObject.uuid) {
      console.log('No UUID with payload');
      return;
    }

    let dictEntry = authDict[payloadObject.uuid];
    if (typeof dictEntry === 'undefined') {
      console.log(`Received an authorization we aren't waiting for: ${payloadObject.uuid}`);
      return;
    }

    console.log('Got a matching authorization!');
    dictEntry += 1;
    authDict[payloadObject.uuid] = dictEntry;

    console.log('AuthDict', authDict);

    const msg = {
      message: `Received an authorization for ${payloadObject.uuid}`,
      uuid: payloadObject.uuid,
      count: dictEntry,
      isMetRequirement: dictEntry >= DEFAULT_NUM_AUTHS, // or, tenant-specific
    };

    console.log('emitting message: ', msg);

    // send to everyone
    io.emit('auth-msg', JSON.stringify(msg));
  });
});

http.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
