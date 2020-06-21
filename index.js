const app = require('express')();

const http = require('http').Server(app);
const address = http.address();

const io = require('socket.io')(http);
const uuidv1 = require('uuid/v1');

const Twilio = require('twilio');
const MessagingResponse = require('twilio').twiml.MessagingResponse;

const config = require('dotenv').config();

const INCOMING = 'incoming';
const OUTGOING = 'outgoing';

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

function cleanNumber(number) {
  console.info('cleaning',number);

  number.replace('+', '');
  number.replace('-', '');

  console.log('number is now ', number);
  return number;
}

const _chats = [
  {
    userId: 1,
    body: 'Hey dude',
    direction: INCOMING,
    dateTime: new Date(
      2020, 6, 10, 12, 30, 43, 0,
    ),
  },
  {
    userId: 1,
    body: 'Hey man',
    direction: OUTGOING,
    dateTime: new Date(
      2020, 6, 10, 12, 31, 43, 0,
    ),
  }
];

const _chatUsers = [
  {
    userId: 1,
    name: 'James Perih',
    email: 'james@hotdang.ca',
    sms: '+13065809501',
  }
];

// UNRELATED. This is the messaging endpoint i might work on for Villains
app.post('/api/messaging/incoming-sms', (req, res) => {
  const smsBody = req.body.Body || req.body.body;
  const from = req.body.From || req.body.from;

  const user = _chatUsers.find((c) => c.sms === from);
  if (!user) {
    console.log('no user found.');
    return res.status(200).json({ message: 'no such user. But we\'ll store them message.'});
  }

  const chatItem = {
    userId: user.userId,
    direction: INCOMING,
    body: smsBody,
    dateTime: new Date(),
  }

  _chats.push(chatItem);

  io.emit('next-message', JSON.stringify(chatItem));
  return res.status(200).json({ status: 'ok'});
  // tell someone to update
});

app.post('/api/messaging/incoming-email', (req, res) => {
  const { content, from } = req.body
  const user = _chatUsers.find((c) => from.indexOf(c.email) > -1);

  if (!user) {
    console.log('no user found.');
    return res.status(200).json({ message: 'no such user. But we\'ll store them message.'});
  }

  const chatItem = {
    userId: user.userId,
    direction: INCOMING,
    body: content.body.split('> On')[0], // first part, before replies
    dateTime: new Date(),
  }

  _chats.push(chatItem);

  io.emit('next-message', JSON.stringify(chatItem));
  return res.status(200).json({ status: 'ok'});
});

// UNRELATED. This is the messaging endpoint i might work on for Villains
app.post('/api/messaging/send-sms', (req, res) => {
  const { userId, content } = req.body;
  console.log(req.body);

  const user = _chatUsers.find((c) => c.userId === userId);
  if (!user) {
    return res.status(404).json({ error: 'not found'});
  }

  // update history
  _chats.push({
    userId,
    body: content,
    direction: OUTGOING,
    dateTime: new Date(),
  });

  const messageBody = {
    from: twilioFrom,
    to: user.sms,
    body: `FROM VILLAINS:\n${content}`,
  };
  
  twilio.messages.create(messageBody, (err, result) => {
    if (err) {
      console.log('Twilio error:', err);
      return;
    }
    console.log(`Twilio result: ${result.sid}`);
  });
  
  // send back new history
  // TODO: make this accumulative maybe
  res.status(200).json({
    status: 'ok',
  });

});

app.get('/api/messaging/users', (req, res) => {
  return res.status(200).json(_chatUsers);
});

app.post('/api/messaging/users', (req, res) => {
  const { name, sms, email } = req.body;
  const user = {
    name,
    sms,
    email,
    userId: _chatUsers[_chatUsers.length -1].userId + 1,
  }

  _chatUsers.push(user);
  io.emit('users-changed', JSON.stringify(_chatUsers));

  return res.status(200).json(_chatUsers);
});

app.post('/api/messaging/send-email', (req, res) => {
  const { userId, content } = req.body;

  const user = _chatUsers.find((u) => u.userId === parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'no such user.'});
  }

  // update history
  _chats.push({
    userId,
    body: content,
    direction: OUTGOING,
    dateTime: new Date(),
  });

  const data = {
    from: `Villains Strength And Conditioning <${MG_FROM}>`,
    'h:Reply-To': 'villains@manyfactor.io',
    to: user.email,
    subject: 'Ongoing chat',
    text: content,
  };

  mg.messages().send(data, function (error, body) {
    if (error) {
      console.log('error', error);
      return res.status(400).json({ error });
    }

    return res.status(200).json({ status: 'ok'});
  });
});

app.get('/api/messaging/get-history/:userId', (req, res) => {
  const { userId } = req.params;
  console.log('fetch history for userId ', userId);
  console.log('all chats', _chats);

  const history = _chats.filter((c) => c.userId === parseInt(userId));
  const user = _chatUsers.find((c) => c.userId === parseInt(userId));
  
  const payload = {
    history,
    user,
  };

  io.emit('next-messages', JSON.stringify(payload));
  return res.status(200).json(payload || {});
});

// UNRELATED. This is the messaging interface for Villains
app.get('/chat', (req, res) => {
  res.sendFile(`${__dirname}/html/chat.html`);
});

// TODO: set up webhook to listen to incoming sms
app.post('/api/webhooks/incoming-sms', (req, res) => {
  console.info('body', req.body);

  const sms = req.body.To || req.body.to;
  const smsBody = req.body.Body || req.body.body;

  console.info(`RECEIVED MESSAGE FROM ${req.body.From || req.body.from }`)

  const cleanReceiverSms = cleanNumber(sms);
  const redirector = redirects.find((r) => cleanNumber(r.fromSms) === cleanReceiverSms);

  if (!redirector) {
    console.info('NO SUCH USER');
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

  socket.on('get-next-message', (payload) => {
    const payloadObject = JSON.parse(payload);
    if (!payloadObject) {
      console.log('No payload Object');
      return;
    }

    const { userId } = payloadObject;
    const user = _chatUsers.find((u) => u.userId === parseInt(userId));
    const userChats = _chats.filter((u) => u.userId === user.userId);
    const lastChat = userChats[userChats.length -1];

    io.emit('next-message', JSON.stringify(lastChat));
  });
});

http.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
