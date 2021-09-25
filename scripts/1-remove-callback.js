// https://astexplorer.net/#/gist/c10ff2a5d406a1d0a4adc8a5366bae09/

const INCLUDE_LIST = ['callback', 'cb', 'next', 'done'];

module.exports = (file, api, options) => {
  const { jscodeshift: j } = api;
  const root = j(file.source);

  const isAsyncLibraryNode = (n) => {
    try {
      return n.callee.object.name.toLowerCase() === 'async';
    } catch (e) {
      return false;
    }
  };

  const getRawValue = (node) => j(node).toSource();
  const getNodeComments = (node) => node.comments || [];
  const findClosestAsyncLibraryNode = (p) => j(p).closest(j.CallExpression, isAsyncLibraryNode);

  const replaceCallbacks = (p) => {
    const paramsLength = p.node.params.length;
    // do nothing
    if (!paramsLength) return p.node;

    // get fn's last param
    const lastItem = p.node.params[paramsLength - 1];
    // lastItem could be an `AssignmentPattern`,
    // when the last value is being defaulted for e.g. (a, b, c = "default") => {},
    // so getting the .left which will be the `Identifier`
    const lastParam = lastItem.left || lastItem;

    if (!INCLUDE_LIST.includes(lastParam.name)) {
      return p.node;
    }

    const wasLastParamCallback =
      j(p)
        .find(j.CallExpression, { callee: { name: lastParam.name } })
        .forEach((p) => {
          const cbHandlerArgs = p.node.arguments || [];
          const argsLength = cbHandlerArgs.length;

          const isWithinAsyncLib = findClosestAsyncLibraryNode(p).size() > 0;

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

            if (isWithinAsyncLib) {
              const returnRaw = getRawValue(replacementNode).replace(/\n/g, '');
              const commentedReturnValue = j.commentLine(` TODO(codemods): return within async: ${returnRaw}`, true, false);
              const commentedReplacementNode = j.emptyStatement();
              commentedReplacementNode.comments = getNodeComments(commentedReplacementNode);
              commentedReplacementNode.comments.push(commentedReturnValue);
              replacementNode = commentedReplacementNode;
            }
          }

          // replacing parent as it's an ExpressionStatement i.e. one that ends with a semi-colon
          const parentNodeCollection = j(p.parent);
          const shouldRemoveParent =
            (removeReturn && parentNodeCollection.isOfType(j.ReturnStatement)) ||
            parentNodeCollection.isOfType(j.ExpressionStatement);
          if (shouldRemoveParent) {
            replacementNode.comments = getNodeComments(p.parent.node).concat(getNodeComments(replacementNode));
            parentNodeCollection.replaceWith(replacementNode);
          }
        })
        .size() > 0;

    // if the last param was a callback then after removing the callbacks,
    // remove that param from fn and make it async
    if (wasLastParamCallback) {
      p.node.params.pop();
      p.node.async = true;
    }

    return p.node;
  };

  root.find(j.FunctionExpression).replaceWith(replaceCallbacks);
  root.find(j.FunctionDeclaration).replaceWith(replaceCallbacks);
  root.find(j.ArrowFunctionExpression).replaceWith(replaceCallbacks);
  return root.toSource();
};
