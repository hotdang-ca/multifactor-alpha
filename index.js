const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const uuidv1 = require('uuid/v1');
const Twilio = require('twilio');
const config = require('dotenv').config();
const address = http.address();

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

if (!twilioAccountSid || !twilioAuthToken) {
  console.log('No twilio configuration.');
  return;
}

const twilio = new Twilio(twilioAccountSid, twilioAuthToken);

const PORT = process.env.PORT || 3002;

const contacts = [];
const twilioFrom = '+13069922727';

// Get this from the tenants database
contacts.push({
  to: '+13065809501',
});

const DEFAULT_NUM_AUTHS = 3;

const authDict = {};

app.get('/', (req, res) => {
  // generate a new uuid
  res.sendFile(`${__dirname}/html/index.html`);
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

    console.log('auths: ', authDict);

    contacts.forEach((recipient) => {
      twilio.messages.create({
        from: twilioFrom,
        to: recipient.to,
        body: `MULTIFACTOR.IO requires your authorization. https://multifactor.herokuapp.com/authorize/${uuid}. DO NOT REPLY`,
      }, (err, result) => {
        if (err) {
          console.log('Twilio error:', err);
          return;
        }

        console.log(`Twilio result: ${result.sid}`);
      });
    });

    const payload = {
      uuid,
      required: DEFAULT_NUM_AUTHS,
    };

    socket.emit('got-uuid', JSON.stringify(payload));
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
  console.log(http);
});
