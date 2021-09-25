// https://astexplorer.net/#/gist/fb9e9aa9b8febd28e9da4e4c5111e699/

module.exports = (file, { jscodeshift: j }) => {
  const isFnNode = (n) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type);
  const getNodeRange = ({ loc: { start, end } }) => `${file.path}:${start.line}:${start.column}; ${end.line}:${end.column}`;

  const functionWrapper = (func) => (p) => {
    try {
      return func(p);
    } catch (error) {
      console.error(`Issue at ${getNodeRange(p.node)}. Error: ${error}`);
      throw error;
    }
  };

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

    let parent = p;
    while (parent) {
      if (isFnNode(parent.node)) {
        parent.node.async = true;
        break;
      }
      parent = parent.parent;
    }

    if (node.arguments.length > 2) throw new Error(`There are more args in async.waterfall(); ${getNodeRange(node)}`);
    const tryFunctions = node.arguments[0].elements.map((fn) => fn.body.body).flat();

    // callback could also be parent fn's callback identifier OR could even be missing
    const hasCallback = node.arguments[1] && isFnNode(node.arguments[1]);
    const callbackFn = node.arguments[1];
    const callbackFnBody = !hasCallback ? [] : callbackFn.body.body;
    const firstParam = !hasCallback ? null : callbackFn.params[0];
    const firstCbExpr = !firstParam ? {} : callbackFnBody[0];

    const hasCatchClause =
      firstParam &&
      firstCbExpr &&
      firstCbExpr.type === 'IfStatement' &&
      firstCbExpr.test.type === 'Identifier' &&
      firstCbExpr.test.name === firstParam.name;

    // if there is, then all it's contents go to the body of `catch` clause
    const catchBody = hasCatchClause
      ? firstCbExpr.consequent.type === 'BlockStatement'
        ? firstCbExpr.consequent
        : j.blockStatement([firstCbExpr.consequent])
      : j.blockStatement([]);

    const catchClause = j.catchClause(firstParam || j.identifier('error'), null, catchBody);

    let afterAwaitExprs = [];
    // if the catch clause is found then everything inside `else` will go below await statement
    if (hasCatchClause) {
      afterAwaitExprs = afterAwaitExprs.concat(
        firstCbExpr.alternate ? firstCbExpr.alternate.body || [firstCbExpr.alternate] : [],
      );
      // remove the `if-else`
      callbackFnBody.shift();
      addComments(
        catchClause,
        (firstCbExpr.comments || []).map((c) => c.value),
      );
    }

    // everything after `if-else` also goes after await call
    afterAwaitExprs = afterAwaitExprs.concat(callbackFnBody);

    const tryStatement = j.tryStatement(j.blockStatement([...tryFunctions, ...afterAwaitExprs].filter(Boolean)), catchClause);
    !hasCatchClause && addComments(tryStatement, [' TODO(codemods): No error clause found']);

    return tryStatement;
  };

  return j(file.source).find(j.CallExpression, isAsyncLib).replaceWith(removeAsyncLib).toSource();
};

function c(...args) {
  console.log(...args);
}
