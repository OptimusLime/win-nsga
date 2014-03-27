//need our general utils functions
module.exports = extendObject;

function extendObject(self, globalConfig, localConfig)
{
    //
    self.winFunction = "evolution";

    //pull logging from the backbone -- handles all messages to the user
    self.log = self.bb.getLogger(self);
    self.log.logLevel = localConfig.logLevel || self.log.normal;
    
    //we need to turn localConfig into what we need!
  
    self.optionalEvents = function()
    {
        var optional = [];

        //there are all the optional events that may be called by this object
        return optional;
    }

    self.requiredEvents = function()
    {
        //don't require any outside modules
        var events = [];
        var internalEvents= self.rEvents;
        //turn our events into an array
        //events are easier organized as an object, but for requirements, we send as array
        for(var func in internalEvents)
        {
            for(var action in internalEvents[func])
            {
                events.push(internalEvents[func][action]);
            }
        }

        self.log('Required gen events: ', events);

        //send back all required events
        return events;
    }

    //normal initialize for now -- going to need to add a novelty schema
    self.initialize = function(done)
    {
        setTimeout(function()
        {
            done();
        })
        // we need to register our particular novelty schema -- it's an object that stores nearby 
        // self.backEmit("schema:addSchema", sampleEncoding.encodingName, sampleEncoding.sampleSchema, function(err)
        // {
        //     if(err)
        //         throw err;

        //         done();

        // })
    }
}




