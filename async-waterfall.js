module.exports = (file, { jscodeshift: j }) => {
  const isAsyncLib = (node) => {
    try {
      return node.callee.object.name.toLowerCase() === 'async' && node.callee.property.name.toLowerCase() === 'waterfall';
    } catch (e) {
      return false;
    }
  };

  const addComments = (node, comments = []) => {
    const existingComments = node.comments || [];
    existingComments.push(...comments.filter(Boolean).map((comment) => j.commentLine(comment, true, false)));
    node.comments = existingComments;
  };

  const removeAsyncLib = (p) => {
    const { node } = p;

    if (!(node.arguments.length === 2)) throw new Error('There are more args in async.waterfall()');
    const tryFunctions = node.arguments[0].elements.map((fn) => fn.body.body).flat();

    const callbackFn = node.arguments[1];
    const firstParam = callbackFn.params[0];
    const firstCbExpr = callbackFn.body.body[0];
    const hasCatchClause =
      firstCbExpr.type === 'IfStatement' && firstCbExpr.test.type === 'Identifier' && firstCbExpr.test.name === firstParam.name;

    // if there is, then all it's contents go to the body of `catch` clause
    const catchBody = hasCatchClause
      ? firstCbExpr.consequent.type === 'BlockStatement'
        ? firstCbExpr.consequent
        : j.blockStatement([firstCbExpr.consequent])
      : j.blockStatement([]);

    const catchClause = j.catchClause(firstParam, null, catchBody);
    let afterAwaitExprs = [];
    // if the catch clause is found then everything inside `else` will go below await statement
    if (hasCatchClause) {
      afterAwaitExprs = afterAwaitExprs.concat(
        firstCbExpr.alternate ? firstCbExpr.alternate.body || [firstCbExpr.alternate] : [],
      );
      // remove the `if-else`
      callbackFn.body.body.shift();
      addComments(
        catchClause,
        (firstCbExpr.comments || []).map((c) => c.value),
      );
    }

    // everything after `if-else` also goes after await call
    afterAwaitExprs = afterAwaitExprs.concat(callbackFn.body.body);

    const tryStatement = j.tryStatement(j.blockStatement([...tryFunctions, ...afterAwaitExprs].filter(Boolean)), catchClause);
    !hasCatchClause && addComments(tryStatement, [' TODO(codemods): No error clause found']);
    return tryStatement;
  };

  return j(file.source).find(j.CallExpression, isAsyncLib).replaceWith(removeAsyncLib).toSource();
};

function c(...args) {
  console.log(...args);
}
