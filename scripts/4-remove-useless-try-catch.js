module.exports = (file, api) => {
  const j = api.jscodeshift;

  const ALSO_REMOVE_EMPTY = true;

  const isUselessTryCatch = (p) => {
    const { node } = p;

    try {
      const catchHandler = node.handler;
      const catchHandlerBody = catchHandler.body.body;
      if (ALSO_REMOVE_EMPTY && catchHandlerBody.length === 0) return true;
      const hasSingleStatementInBody = catchHandlerBody.length === 1;
      const whichIsAThrowStatement = catchHandlerBody[0].type === 'ThrowStatement';
      const whichIsThrowingErrorJustCaught = catchHandler.param.name === catchHandlerBody[0].argument.name;
      return hasSingleStatementInBody && whichIsAThrowStatement && whichIsThrowingErrorJustCaught;
    } catch (e) {
      return false;
    }
  };

  const removeTryCatch = (p) => {
    return p.node.block.body;
  };

  return j(file.source).find(j.TryStatement).filter(isUselessTryCatch).replaceWith(removeTryCatch).toSource();
};
