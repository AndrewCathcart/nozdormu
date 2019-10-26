const Discord = require('discord.js');

module.exports = {
  name: 'add-raid',
  args: true,
  usage:
    '<UTC Date (e.g. 2019-04-02)> <optional sentence giving the event a description>',
  description: 'An  a raid given a date argument.',
  execute(message, args) {
    const date = new Date(args[0]);
    const day = args[0].split('-').slice(-1)[0];

    if (!isValidDate(date, day)) {
      return message.reply(
        `You've entered an incorrect date! yyyy-mm-dd please 😄`
      );
    }

    // Handle setting an event in the past
    if (date.setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0)) {
      return message.reply(
        `You can't schedule an event in the past!`
      );
    }

    // TODO: Add code here to add a date column to the sheet

    message.channel.send(`Scheduled raid on ${args[0]}.`);

    const embed = new Discord.RichEmbed()
      .setColor('#0099ff')
      .setTitle(`Upcoming raid on ${args[0]}.`)
      .setURL('https://discord.js.org/')
      .setAuthor(
        'Nozdormu the Timeless One',
        'https://i.imgur.com/X1vRk0Y.jpg',
        'https://discord.js.org'
      )
      .setFooter(
        'Please react to this message to confirm your attendance!'
      )
      .setThumbnail('https://i.imgur.com/kBHGjbS.jpg');

    // Take the rest of the arguments as the embed description
    if (args.length > 1) {
      embed.setDescription(args.slice(1, args.length).join(' '));
    }

    // Bot reacting to the newly posted embed in the correct order
    let sentMessage;
    message.channel
      .send(embed)
      .then(message => {
        sentMessage = message;
        message.react('✅').then(() => {
          sentMessage.react('❌');
        });
      })
      .catch('Failed to add reactions to embedded post.');
  }
};

const isValidDate = (date, day) => {
  return Boolean(+date) && date.getDate() == day;
};
