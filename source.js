async.waterfall(	
    [	
      function (next) {	
        if (_.isEmpty(deviceId)) {	
          logger.debug('validateCustomerDeviceAuthentication - missing deviceId');	
          next(boom.unauthorized(null, 'basic')); // empty message - allow to try another strategy);	
        } else {	
          deviceId = deviceId.toUpperCase();	
          next(null);	
        }
      },	
      (next) => {	
        validateProjectAndChannel(projectId, channelId, channelKey, true, function (error, project) {	
          next(error, project);	
        });	
      },	
      function (project, next) {	
        CustomerModel.findActiveCustomerByDeviceId(project.projectId, deviceId, function (error, customer) {	
          if (error || _.isEmpty(customer)) {	
            next(boom.unauthorized(null, 'basic')); // empty message - allow to try another strategy	
          } else {	
            next(null, project, customer);	
          }	
        });	
      },	
    ],	
    function completed(error, project, customer) {	
      if (error) {	
        logger.debug('validateCustomerDeviceAuthentication failed');	
        logger.debug('projectId: ' + projectId);	
        logger.debug('channelId: ' + channelId);	
        logger.debug('channelKey: ' + channelKey);	
        logger.debug('deviceId: ' + deviceId);	
        return callback(error);	
      }	
      callback(null, true, {	
        project: project,	
        customer: customer,	
        deviceId: deviceId,	
        strategy: common.AUTH_STRATEGY_SIMPLE_CUSTOMER_DEVICE,	
      });	
    },	
  ); 