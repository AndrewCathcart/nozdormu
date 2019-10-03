const fs = require('fs');
const Discord = require('discord.js');
const { token, prefix } = require('./config.json');
const readline = require('readline');
const { google } = require('googleapis');

const client = new Discord.Client();
client.commands = new Discord.Collection();

const commandFiles = fs
  .readdirSync('./commands')
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}

client.once('ready', () => {
  console.log('Bot is now online.');
});

client.on('message', message => {
  if (
    //!message.member.roles.some(role => role.name === 'Management') ||
    !message.content.startsWith(prefix) ||
    message.author.bot
  ) {
    return;
  }

  const args = message.content.slice(prefix.length).split(/ +/);
  const commandName = args.shift().toLowerCase();

  // If we don't have the command then simply return
  if (!client.commands.has(commandName)) return;

  const command = client.commands.get(commandName);

  // Check if any arguments were passed with the command
  if (command.args && !args.length) {
    let reply = `You didn't provide any arguments, ${message.author}!`;

    if (command.usage) {
      reply += `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``;
    }

    return message.channel.send(reply);
  }

  // Otherwise try and execute the command
  try {
    command.execute(message, args);
  } catch (error) {
    console.error(error);
  }
});

const events = {
  MESSAGE_REACTION_ADD: 'messageReactionAdd',
  MESSAGE_REACTION_REMOVE: 'messageReactionRemove'
};

//  Watching for all raw events as messageReactionAdd or messageReactionRemove doesn't always emit events.
//  Events only trigger for cached messages - this makes those events trigger for all messages.
client.on('raw', async event => {
  if (!events.hasOwnProperty(event.t)) {
    return;
  }

  const { d: data } = event;
  const user = client.users.get(data.user_id);
  const channel =
    client.channels.get(data.channel_id) || (await user.createDM());

  if (channel.messages.has(data.message_id)) {
    return;
  }

  const message = await channel.fetchMessage(data.message_id);

  const emojiKey = data.emoji.id
    ? `${data.emoji.name}:${data.emoji.id}`
    : data.emoji.name;

  let reaction = message.reactions.get(emojiKey);
  if (!reaction) {
    const emoji = new Discord.Emoji(
      client.guilds.get(data.guild_id),
      data.emoji
    );

    reaction = new Discord.MessageReaction(
      message,
      emoji,
      1,
      data.user_id === client.user.id
    );
  }

  client.emit(events[event.t], reaction, user);
});

client.on('messageReactionAdd', (reaction, user) => {
  const username = user.username;
  const date = reaction.message.embeds[0].title;

  // console.log(title);
  // console.log(`${username} reacted with "${reaction.emoji.name}".`);

  fs.readFile('credentials.json', (err, content) => {
    if (err)
      return console.log('Error loading client secret file:', err);
    authorize(JSON.parse(content), listUsers, { username, date });
  });
});

client.on('messageReactionRemove', (reaction, user) => {
  // console.log(
  //   `${user.username} removed their "${reaction.emoji.name}" reaction.`
  // );
});

client.login(token);

// If modifying these scopes, delete token.json.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback, args) {
  const {
    client_secret,
    client_id,
    redirect_uris
  } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client, args);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the code from that page here: ', code => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err)
        return console.error(
          'Error while trying to retrieve access token',
          err
        );
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function listUsers(auth, args) {
  console.log(args);

  const sheets = google.sheets({ version: 'v4', auth });
  sheets.spreadsheets.values.get(
    {
      spreadsheetId: '1kTlvBbBJjmjLva9257DHPy7Fm41Uc8ZXk_oSitokYsc',
      range: 'RaidScheduleReactions!A:Z'
    },
    (err, res) => {
      if (err) {
        return console.log('The API returned an error: ' + err);
      }
      const rows = res.data.values;
      if (rows.length) {
        dateRow = rows[0];
        nameCol = rows.map(row => {
          return row[0];
        });

        console.log(dateRow);
        console.log(nameCol);

        let nameRow;
        if (nameCol.includes(args.username)) {
          nameRow = nameCol.indexOf(args.username) + 1;
        } else {
          nameRow = nameCol.length + 1;
          // insert name into this row
        }
        console.log('name on row', nameRow);
      } else {
        console.log('No data found.');
      }
    }
  );
}
