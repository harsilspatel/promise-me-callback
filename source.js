function validateKong(request, callback) {
  logger.debug('validateKong');
    // Non-device user, e.g. dashboard user
  async.waterfall(
    [
      function (next) {
        validateProject(projectId, function (err, project) {
          next(err, project);
        });
      },
      function (project, next) {
        if (isServerRequest) return next(null, project, null);
        AttendantModel.findOne({ _id: attendantId, deleted: false }, function (error, attendant) {
          if (error) {
            logger.error('Error occurred while retrieving attendant');
            next(ApiError.unauthorized());
          } else {
            console.log("bleh");
            next(null, project, attendant);
          }
        });
      },
      function (project, attendant, next) {
        if (isServerRequest) return next(null, project, null);
        if (attendantId !== attendant._id.toString()) {
          logger.error('attendantId mismatch error between kong and CnC');
          next(ApiError.unauthorized());
        } else {
          updateUserId(attendant, userId, function (err, updatedAttendant) {
            next(err, project, attendant);
          });
        }
      },
    ],
    function completed(err, project, attendant) {
      if (err) {
        return callback(err);
      }
      return callback(null, true, {
        project,
        attendant,
        attendantId,
        strategy: common.AUTH_STRATEGY_KONG,
      });
    },
  );
}
