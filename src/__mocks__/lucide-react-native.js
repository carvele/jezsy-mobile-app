const React = require('react');

const mockComponent = (name) => {
  const Comp = (props) => React.createElement(name, props, props.children);
  Comp.displayName = name;
  return Comp;
};

module.exports = new Proxy({}, {
  get: (_, prop) => mockComponent(String(prop)),
});
