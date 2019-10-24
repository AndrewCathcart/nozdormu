module.exports = {
  name: 'remove-raid',
  args: true,
  usage: '<date>',
  description: 'Remove a scheduled raid on the given date.',
  execute(message, args) {
    // TODO:
    // Check if it exists in google sheets
    // if it does, remove the column (probably delete it)
    // if it doesn't, send a message to chat

    // Check if a message exists in the channel for the specified date
    // if it does, remove it
    // if it doesn't, send a message to chat
    message.channel.send(
      `Removed raid on ${args[0]} from the schedule.`
    );
  }
};
