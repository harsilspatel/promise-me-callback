// parser: recast
// transformer: jscodeshift

module.exports = (file, api, options) => {
  const { jscodeshift: j } = api;
  const root = j(file.source);

  const getRawValue = (node) => j(node).toSource();

  const replacedTernaries = root
    // ConditionalExpression = {test} ? {consequent} : {alternate}
    .find(j.ConditionalExpression)

    // refactor the ones where test == consequent
    .filter((path) => getRawValue(path.node.test) === getRawValue(path.node.consequent))

    // replace the ternary with a logical OR
    .replaceWith((p) => {
      return j.logicalExpression('||', p.node.test, p.node.alternate);
    });

  return replacedTernaries.toSource();
};
