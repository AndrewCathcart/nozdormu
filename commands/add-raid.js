module.exports = {
  name: 'add-raid',
  args: true,
  usage: '<date>',
  description: 'Schedule a raid given a date argument.',
  execute(message, args) {
    message.channel.send(`Scheduled raid on ${args[0]}.`);
  }
};
