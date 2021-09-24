module.exports = (file, api, options) => {
  const { jscodeshift: j } = api;
  const root = j(file.source);

  const isAsyncLibraryNode = (n) => {
    try {
      return false;
      return n.callee.object.name.toLowerCase() === 'async';
    } catch (e) {
      return false;
    }
  };

  const replaceCallbacks = (p) => {
    const paramsLength = p.node.params.length;
    // do nothing
    if (!paramsLength) return p.node;

    // get fn's last param
    const lastParam = p.node.params[paramsLength - 1];

    const wasLastParamCallback =
      j(p)
        .find(j.CallExpression, { callee: { name: lastParam.name } })
        .filter((p) => j(p).closest(j.CallExpression, isAsyncLibraryNode).size() === 0) // should not be within async
        .forEach((p) => {
          const cbHandlerArgs = p.node.arguments || [];
          const argsLength = cbHandlerArgs.length;

          let removeReturn = false;
          let replacementNode = null;
          const errorArg = cbHandlerArgs[0] || {};
          // TODO(harsilspatel): handle return next(err, <>) instances
          // if it is like next(<singleParam>) then it likely is an error
          if (argsLength === 1 && !(errorArg.type === 'Literal' && errorArg.value === null)) {
            removeReturn = true;
            replacementNode = j.throwStatement(errorArg);
          } else {
            // return single argument or return array of multiple elements
            // remove error from return
            removeReturn = true;
            cbHandlerArgs.shift(); // argsLength length changes here

            replacementNode = j.returnStatement(
              cbHandlerArgs.length <= 1
                ? cbHandlerArgs[0] || null // if it's 0 arguments it'll pick up the null
                : j.arrayExpression(cbHandlerArgs),
            );
          }

          // replacing parent as it's an ExpressionStatement i.e. one that ends with a semi-colon

          const parentNodeCollection = j(p.parent);
          const shouldRemoveParent =
            (removeReturn && parentNodeCollection.isOfType(j.ReturnStatement)) ||
            parentNodeCollection.isOfType(j.ExpressionStatement);
          if (shouldRemoveParent) {
            replacementNode.comments = p.parent.node.comments || [];
            parentNodeCollection.replaceWith(replacementNode);
          }
        })
        .size() > 0;

    // if the last param was a callback then after removing the callbacks, remove that param from fn
    wasLastParamCallback && p.node.params.pop();

    return p.node;
  };

  root.find(j.FunctionExpression).replaceWith(replaceCallbacks);
  root.find(j.FunctionDeclaration).replaceWith(replaceCallbacks);
  root.find(j.ArrowFunctionExpression).replaceWith(replaceCallbacks);
  return root.toSource();
};
