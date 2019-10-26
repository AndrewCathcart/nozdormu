const fs = require('fs');
const Discord = require('discord.js');
const { token, prefix } = require('../config.json');

const {
  positiveResponse,
  authorize
} = require('../utils/sheets-helper.js');

const client = new Discord.Client();
client.commands = new Discord.Collection();

const commandFiles = fs
  .readdirSync('./commands')
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`../commands/${file}`);
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

//  Watching for all raw events as messageReactionAdd or messageReactionRemove doesn't always emit events.
//  Events only trigger for cached messages. Workaround by manually recreating the reaction events from the raw events.
client.on('raw', async event => {
  // We only care about reactions being added or removed
  const events = {
    MESSAGE_REACTION_ADD: 'messageReactionAdd',
    MESSAGE_REACTION_REMOVE: 'messageReactionRemove'
  };

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
  const date = reaction.message.embeds[0].title
    .replace(/[^0-9\-]+/, '')
    .replace('.', '');

  fs.readFile('credentials.json', (err, content) => {
    if (err) {
      return console.log('Error loading client secret file:', err);
    }

    if (reaction.emoji.name === '✅') {
      authorize(JSON.parse(content), positiveResponse, {
        username,
        date
      });
    }

    if (reaction.emoji.name === '❌') {
      // do negative response function call
    }
  });
});

client.on('messageReactionRemove', (reaction, user) => {
  // If someone removes their reaction then default it to NO with a timestamp
});

client.login(token);
