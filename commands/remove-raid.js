module.exports = {
  name: 'remove-raid',
  args: true,
  usage: '<date>',
  description: 'Remove a scheduled raid on the given date.',
  execute(message, args) {
    message.channel.send(
      `Removed raid on ${args[0]} from the schedule.`
    );
  }
};
