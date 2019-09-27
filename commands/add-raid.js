const Discord = require('discord.js');

module.exports = {
  name: 'add-raid',
  args: true,
  usage: '<date>',
  description: 'Schedule a raid given a date argument.',
  execute(message, args) {
    message.channel.send(`Scheduled raid on ${args[0]}.`);
    console.log(message.guild.emojis);

    const embed = new Discord.RichEmbed()
      .setColor('#0099ff')
      .setTitle(`Upcoming raid on ${args[0]}.`)
      .setURL('https://discord.js.org/')
      .setAuthor(
        'Nozdormu the Timeless One',
        'https://i.imgur.com/X1vRk0Y.jpg',
        'https://discord.js.org'
      )
      .setDescription(
        'Please react to this message to confirm your attendance!'
      )
      .setThumbnail('https://i.imgur.com/kBHGjbS.jpg');

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
