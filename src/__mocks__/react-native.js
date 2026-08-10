module.exports = {
  Platform: {
    OS: 'web',
    select: (obj) => obj.web || obj.default,
  },
};
