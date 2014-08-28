/*!
   angular-block-ui v0.0.12
   (c) 2014 (null) McNull https://github.com/McNull/angular-block-ui
   License: MIT
*/
(function(angular) {

var blkUI = angular.module('blockUI', []);

blkUI.config(["$provide", "$httpProvider", function($provide, $httpProvider) {

  $provide.decorator('$exceptionHandler', ['$delegate', '$injector',
    function($delegate, $injector) {
      var blockUI, blockUIConfig;

      return function(exception, cause) {

        blockUIConfig = blockUIConfig || $injector.get('blockUIConfig');

        if (blockUIConfig.resetOnException) {
          blockUI = blockUI || $injector.get('blockUI');
          blockUI.instances.reset();
        }

        $delegate(exception, cause);
      };
    }
  ]);

  $httpProvider.interceptors.push('blockUIHttpInterceptor');
}]);

blkUI.run(["$document", "blockUIConfig", "$templateCache", function($document, blockUIConfig, $templateCache) {
  if(blockUIConfig.autoInjectBodyBlock) {
    $document.find('body').attr('block-ui', 'main');
  }
}]);

blkUI.directive('blockUiContainer', ["blockUIConfig", "blockUiContainerLinkFn", function (blockUIConfig, blockUiContainerLinkFn) {
  return {
    scope: true,
    restrict: 'A',
    templateUrl: blockUIConfig.templateUrl,
    link: blockUiContainerLinkFn
  };
}]).factory('blockUiContainerLinkFn', ["blockUI", "blockUIUtils", function (blockUI, blockUIUtils) {

  return function ($scope, $element, $attrs) {

    $element.addClass('block-ui-container');

    var srvInstance = $element.inheritedData('block-ui');

    if (!srvInstance) {
      throw new Error('No parent block-ui service instance located.');
    }

    // Expose the state on the scope

    $scope.state = srvInstance.state();

    $scope.$watch('state.blocking', function(value) {
      $element.toggleClass('block-ui-visible', !!value);
    });

    $scope.$watch('state.blockCount > 0', function(value) {
      $element.toggleClass('block-ui-active', !!value);
    });
  };
}]);
blkUI.directive('blockUi', ["blockUiCompileFn", function(blockUiCompileFn) {

  return {
    restrict: 'A',
    compile: blockUiCompileFn
  };

}]).factory('blockUiCompileFn', ["blockUiLinkFn", function(blockUiLinkFn) {

  return function($element, $attrs) {
    $element.append('<div block-ui-container></div>');
    return blockUiLinkFn;
  };

}]).factory('blockUiLinkFn', ["blockUI", "blockUIUtils", function(blockUI, blockUIUtils) {

  return function($scope, $element, $attrs) {

    $element.addClass('block-ui');

    // Create the blockUI instance
    // Prefix underscore to prevent integers:
    // https://github.com/McNull/angular-block-ui/pull/8

    var instanceId = $attrs.blockUi || '_' + $scope.$id;
    var srvInstance = blockUI.instances.get(instanceId);

    // If this is the main (topmost) block element we'll also need to block any
    // location changes while the block is active.

    if (instanceId === 'main') {

      // After the initial content has been loaded we'll spy on any location
      // changes and discard them when needed.

      var fn = $scope.$on('$viewContentLoaded', function($event) {

        // Unhook the view loaded and hook a function that will prevent
        // location changes while the block is active.

        fn();
        $scope.$on('$locationChangeStart', function(event) {
          if (srvInstance.state().blockCount > 0) {
            event.preventDefault();
          }
        });
      });
    } else {
      // Locate the parent blockUI instance
      var parentInstance = $element.inheritedData('block-ui');

      if(parentInstance) {
        // TODO: assert if parent is already set to something else
        srvInstance._parent = parentInstance;
      }
    }

    // Ensure the instance is released when the scope is destroyed

    $scope.$on('$destroy', function() {
      srvInstance.release();
    });

    // Increase the reference count

    srvInstance.addRef();

    // Set the aria-busy attribute if needed

    $scope.$watch(function() {
      return srvInstance.state().blocking;
    }, function (value) {
      $element.attr('aria-busy', value);
    });

    // If a pattern is provided assign it to the state

    var pattern = $attrs.blockUiPattern;

    if(pattern) {
      var regExp = blockUIUtils.buildRegExp(pattern);
      srvInstance.pattern(regExp);
    }

    // Store a reference to the service instance on the element

    $element.data('block-ui', srvInstance);
  };

}]);
blkUI.provider('blockUIConfig', function() {

  var _config = {
    templateUrl: 'angular-block-ui/angular-block-ui.ng.html',
    delay: 250,
    message: "Loading ...",
    autoBlock: true,
    resetOnException: true,
    requestFilter: angular.noop,
    autoInjectBodyBlock: true
  };

  this.templateUrl = function(url) {
    _config.templateUrl = url;
  };

  this.template = function(template) {
    _config.template = template;
  };

  this.delay = function(delay) {
    _config.delay = delay;
  };

  this.message = function(message) {
    _config.message = message;
  };

  this.autoBlock = function(enabled) {
    _config.autoBlock = enabled;
  };

  this.resetOnException = function(enabled) {
    _config.resetOnException = enabled;
  };

  this.requestFilter = function(filter) {
    _config.requestFilter = filter;
  };

  this.autoInjectBodyBlock = function(enabled) {
    _config.autoInjectBodyBlock = enabled;
  };

  this.$get = ['$templateCache', function($templateCache) {

    if(_config.template) {

      // Swap the builtin template with the custom template.
      // Create a unique cache key and place the template in the cache.

      _config.templateUrl = '$$block-ui-template$$';
      $templateCache.put(_config.templateUrl, _config.template);
    }

    return _config;
  }];
});

blkUI.factory('blockUIHttpInterceptor', ["$q", "$injector", "blockUIConfig", function($q, $injector, blockUIConfig) {

  var blockUI;

  function injectBlockUI() {
    blockUI = blockUI || $injector.get('blockUI');
  }

  function stopBlockUI(config) {
    if (blockUIConfig.autoBlock && !config.$_noBlock && config.$_blocks) {
      injectBlockUI();
      config.$_blocks.stop();
    }
  }

  function error(rejection) {
    stopBlockUI(rejection.config);
    return $q.reject(rejection);
  }

  return {
    request: function(config) {

      if (blockUIConfig.autoBlock) {

        // Don't block excluded requests

        if (blockUIConfig.requestFilter(config) === false) {
          // Tag the config so we don't unblock this request
          config.$_noBlock = true;
        } else {
          injectBlockUI();

          config.$_blocks = blockUI.instances.locate(config);
          config.$_blocks.start();
        }
      }

      return config;
    },

    requestError: error,

    response: function(response) {
      stopBlockUI(response.config);
      return response;
    },

    responseError: error
  };

}]);

blkUI.factory('blockUI', ["blockUIConfig", "$timeout", "blockUIUtils", "$document", function(blockUIConfig, $timeout, blockUIUtils, $document) {

  var $body = $document.find('body');

  function BlockUI(id) {

    var self = this;

    var state = {
      id: id,
      blockCount: 0,
      message: blockUIConfig.message,
      blocking: false
    }, startPromise, doneCallbacks = [];

    this._refs = 0;

    this.start = function(message) {

      if(state.blockCount > 0) {
        message = message || state.message || blockUIConfig.message;
      } else {
        message = message || blockUIConfig.message;
      }

      state.message = message;

      state.blockCount++;

      // Check if the focused element is part of the block scope

      var $ae = angular.element($document[0].activeElement);

      if($ae.length && blockUIUtils.isElementInBlockScope($ae, self)) {

        // Let the active element lose focus and store a reference 
        // to restore focus when we're done (reset)

        self._restoreFocus = $ae[0];

        // https://github.com/McNull/angular-block-ui/issues/13
        // http://stackoverflow.com/questions/22698058/apply-already-in-progress-error-when-using-typeahead-plugin-found-to-be-relate
        // Queue the blur after any ng-blur expression.

        $timeout(function() {
          // Ensure we still need to blur
          if(self._restoreFocus) {
            self._restoreFocus.blur();
          }
        });
      }

      if (!startPromise) {
        startPromise = $timeout(function() {
          startPromise = null;
          state.blocking = true;
        }, blockUIConfig.delay);
      }
    };

    this._cancelStartTimeout = function() {
      if (startPromise) {
        $timeout.cancel(startPromise);
        startPromise = null;
      }
    };

    this.stop = function() {
      state.blockCount = Math.max(0, --state.blockCount);

      if (state.blockCount === 0) {
        self.reset(true);
      }
    };

    this.message = function(value) {
      state.message = value;
    };

    this.pattern = function(regexp) {
      if (regexp !== undefined) {
        self._pattern = regexp;
      }

      return self._pattern;
    };

    this.reset = function(executeCallbacks) {
      
      self._cancelStartTimeout();
      state.blockCount = 0;
      state.blocking = false;

      // Restore the focus to the element that was active
      // before the block start, but not if the user has 
      // focused something else while the block was active.

      if(self._restoreFocus && 
         (!$document[0].activeElement || $document[0].activeElement === $body[0])) {
        self._restoreFocus.focus();
        self._restoreFocus = null;
      }
      
      try {
        if (executeCallbacks) {
          angular.forEach(doneCallbacks, function(cb) {
            cb();
          });
        }
      } finally {
        doneCallbacks.length = 0;
      }
    };

    this.done = function(fn) {
      doneCallbacks.push(fn);
    };

    this.state = function() {
      return state;
    };

    this.addRef = function() {
      self._refs += 1;
    };

    this.release = function() {
      if(--self._refs <= 0) {
        mainBlock.instances._destroy(self);
      }
    };
  }

  var instances = [];

  instances.get = function(id) {
    var instance = instances[id];

    if(!instance) {
      // TODO: ensure no array instance trashing [xxx] -- current workaround: '_' + $scope.$id
      instance = instances[id] = new BlockUI(id);
      instances.push(instance);
    }

    return instance;
  };

  instances._destroy = function(idOrInstance) {
    if (angular.isString(idOrInstance)) {
      idOrInstance = instances[idOrInstance];
    }

    if (idOrInstance) {
      idOrInstance.reset();
      delete instances[idOrInstance.state().id];
      var i = instances.length;
      while(--i) {
        if(instances[i] === idOrInstance) {
          instances.splice(i, 1);
          break;
        }
      }
    }
  };
  
  instances.locate = function(request) {

    var result = [];

    // Add function wrappers that will be executed on every item
    // in the array.
    
    blockUIUtils.forEachFnHook(result, 'start');
    blockUIUtils.forEachFnHook(result, 'stop');

    var i = instances.length;

    while(i--) {
      var instance = instances[i];
      var pattern = instance._pattern;

      if(pattern && pattern.test(request.url)) {
        result.push(instance);
      }
    }

    if(result.length === 0) {
      result.push(mainBlock);
    }

    return result;
  };

  // Propagate the reset to all instances

  blockUIUtils.forEachFnHook(instances, 'reset');

  var mainBlock = instances.get('main');

  mainBlock.addRef();
  mainBlock.instances = instances;

  return mainBlock;
}]);


blkUI.factory('blockUIUtils', function() {

  var utils = {
    buildRegExp: function(pattern) {
      var match = pattern.match(/^\/(.*)\/([gim]*)$/), regExp;

      if(match) {
        regExp = new RegExp(match[1], match[2]);
      } else {
        throw Error('Incorrect regular expression format: ' + pattern);
      }

      return regExp;
    },
    forEachFn: function(arr, fnName, args) {
      var i = arr.length;
      while(i--) {
        var t = arr[i];
        t[fnName].apply(t, args);
      }
    },
    forEachFnHook: function(arr, fnName) {
      arr[fnName] = function() {
        utils.forEachFn(this, fnName, arguments);
      }
    },
    isElementInBlockScope: function($element, blockScope) {
      var c = $element.inheritedData('block-ui');

      while(c) {
        if(c === blockScope) {
          return true;
        }

        c = c._parent;
      }

      return false;
    }
  };

  return utils;

});
// Automatically generated.
// This file is already embedded in your main javascript output, there's no need to include this file
// manually in the index.html. This file is only here for your debugging pleasures.
angular.module('blockUI').run(['$templateCache', function($templateCache){
  $templateCache.put('angular-block-ui/angular-block-ui.ng.html', '<div class=\"block-ui-overlay\"></div><div class=\"block-ui-message-container\" aria-live=\"assertive\" aria-atomic=\"true\"><div class=\"block-ui-message\">{{ state.message }}</div></div>');
}]);
})(angular);
//# sourceMappingURL=angular-block-ui.js.map