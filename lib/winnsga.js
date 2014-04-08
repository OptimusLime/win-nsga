//need our general utils functions
var winutils = require('win-utils');
var extendModuleDefinitions = require('./module/backbone.js');
var traverse = require('optimuslime-traverse');
//for component: techjacker/q
var evoContainer = require('./multiobjective/nsga-evo.js');

var Q = require('q');

var uuid = winutils.cuid;
var wMath = winutils.math;

module.exports = winnsga;


function winnsga(winBackbone, globalConfig, localConfig)
{
    var self = this;

    //grab our backbone object
    self.bb = winBackbone;

    self.pathDelimiter = "///";

    //all our required events!
    //we need someone to evaluate our artifacts for behavior and make store objects request
    self.rEvents = {
        evaluate : {
            'evaluateArtifacts' : 'evaluate:evaluateArtifacts'
            ,'clearEvaluations' : 'evaluate:clearEvaluations'
            ,'measureObjectives' : 'evaluate:measureObjectives'
        },
        // encoding : { //need to measure distance among a collection of objects
            // 'getGeneticDistance' : 'encoding:getGeneticDistance'                       
        // },
        generator : 
        {
            'createArtifacts' : 'generator:createArtifacts'
        },
        evolution : {
            // 'storeObjects' : 'evolution:storeObjectsRequest' 
            //we also need to know when to stop evolution once it's started
            'shouldEndEvolution' : 'evolution:shouldEndEvolution'                       
            ,'finishedEvolution' : 'evolution:finishedEvolution'
            ,'clearEvolution' : 'evolution:clearEvolution'
                                   

        },
        schema: {
            'addSchema' : 'schema:addSchema'
        }
    };

    //extend this object to work with win backbone (simple functions)
    //don't want to get that confused -- so it's in another file
    extendModuleDefinitions(self, globalConfig, localConfig);

    //all put together, now let's build an emitter for the backbone
    self.backEmit = winBackbone.getEmitter(self);

    //though the following calls can be done in the extendModuleDefinitions, it's clearer to have them in the main .js file 
    //to see what events are accepted for this module
    var fullEventName = function(partialName)
    {
        return self.winFunction + ":" + partialName;
    }

    //we are evolution
    //these are the various callbacks we accept as events
    self.eventCallbacks = function()
    {
        var callbacks = {};

        //add callbacks to the object-- these are the functions called when the full event is emitted
        callbacks[fullEventName("nsga-startEvolution")] = self.startEvolution;
        callbacks[fullEventName("nsga-pauseEvolution")] = self.pauseEvolution;
        //get rid of it all!
        callbacks[fullEventName("nsga-deleteEvolution")] = self.endEvolution;

        //send back our callbacks
        return callbacks;
    }

    var asyncCall = function(fn, iParam)
    {

        //no async calls allowed with an invalid loop
        if(iParam < self.currentLoop)
            return;
        // if(process == undefined)
            setTimeout(function()
                {
                    fn(iParam);

                }, 0);
        // else
            // process.nextTick(fn);
    }


    var qBackboneResponse = function()
    {
        var defer = Q.defer();
        // self.log('qBBRes: Original: ', arguments);

        //first add our own function type
        var augmentArgs = arguments;
        // [].splice.call(augmentArgs, 0, 0, self.winFunction);
        //make some assumptions about the returning call
        var callback = function(err)
        {
            if(err)
            {
                defer.reject(err);
            }
            else
            {
                //remove the error object, send the info onwards
                [].shift.call(arguments);
                if(arguments.length > 1)
                    defer.resolve(arguments);
                else
                    defer.resolve.apply(defer, arguments);
            }
        };

        //then we add our callback to the end of our function -- which will get resolved here with whatever arguments are passed back
        [].push.call(augmentArgs, callback);

        // self.log('qBBRes: Augmented: ', augmentArgs);
        //make the call, we'll catch it inside the callback!
        self.backEmit.apply(self.bb, augmentArgs);

        return defer.promise;
    }

    
    self.evolutionInProgress = false;
    self.evolutionRunning = false;

    self.endEvolution = function()
    {
        if(self.evolutionInProgress || self.evolutionRunning)
        {

            //start by pausingin -- these are healthy steps
            self.evolutionInProgress = false;
            self.evolutionRunning = false;

            //shut down our evo object -- no questions at this time please
            self.evoObject.shutDown();

            //we're responsible for clearing out evaluations and evolution
            self.backEmit.qConcurrent([['evolution:clearEvolution'], ['evaluate:clearEvaluations']]);

        }


        //the rest will be handled when evolution is created again
        //which will be after the current gerneation ends anyways

        //so all done -- everything will be overwritten
    }
    //run for however long it takes, then finish it up!
    //this should be run on a completely separate thread, btw
    //need to create a forked process?
    //not our problem -- evaluation will deal with it
    self.startEvolution = function(evoProps, seeds, evoError, finished)
    {
        if(typeof seeds == "function" || typeof evoProps == "function")
            throw new Error("Improper evolution inputs evoProps [object], seeds [array], evoError [function], finished [function]")
        //genomeType is assumed to have a wid
        if(!evoProps.genomeType)
            throw new Error("The schema type for genomes must be specified for win-NSGA-II startEvolution in order to accurately generate objects.");


        if(self.evolutionRunning){
            //end evolution ourselves immediately
            // self.endEvolution();
            self.currentLoop++;
            self.endEvolution();
            // self.backEmit.qConcurrent([['evolution:clearEvolution'], ['evaluate:clearEvaluations']]);
        }

        //real current loop
        var currentLoop = self.currentLoop;


        //we can assume no evolution running
        if(self.evolutionInProgress)
        {
            //let it be known that evolution is running again!
            self.evolutionRunning = true;
            asyncCall(internalGenerationLoop, currentLoop);
            finished();
        }
        else
        {
            //make sure we have what we need!
            if(!seeds || !evoProps)
                throw new Error("To start a new evolutionary run, you need seed objects and evolution poperties (like elitism rate)");

            //we haven't started evolution yet -- we need to initialize everything
            self.evolutionInProgress = true;
            self.evolutionRunning = true;
            self.evoError = evoError;

            //build our container
            self.evoObject = new evoContainer(evoProps, localConfig, self.backEmit, self.log);
            self.log("Props: ", evoProps, " seeds: ", seeds);

            //init our population using the provided seeds
            //this will also force evaluation to occur
            self.evoObject.createInitialPopulation(evoProps, seeds)
                .then(function()
                {
                    //after we're done running a generation (even the first) -- we need to check if we're all finished -- or to puase or whatever
                    return qBackboneResponse("evolution:shouldEndEvolution", self.evoObject.generation, self.evoObject.population, self.evoObject.popEvaluations);
                })
                .then(function(shouldFinish)
                {
                    if(shouldFinish){

                    }

                    self.log("Initial population success!");
                    //begin the looping -- evolution is expensive
                    //while evolution is running - it will schedule a new generation for every tick
                    //when it's paused, it won't do anything until started again
                    asyncCall(internalGenerationLoop, currentLoop);
                    //we started evolution -- all good to go for callback
                    finished();

                })
                .fail(function(err)
                {
                    self.log("Failing at start: ", err.stack);
                    //if you are aborted during the first eval -- you get caught here
                     if(!self.evolutionInProgress || !self.evolutionRunning)
                        finished();
                    else
                        //gotta fail fool
                        finished(err);
                })

        }


    }
     self.pauseEvolution = function(finished)
    {
        //stop the evolution object from running
        self.evolutionRunning = false;

        //call finished later
        asyncCall(finished, self.currentLoop);
    }

    self.currentLoop = 0;

    //this is for running a fixed number of genrations --
    //other functions might run until the archive is a certain size
    function internalGenerationLoop(loopID)
    {

        if(loopID < self.currentLoop)
            return;

        self.log("Performing one nsga generation");

        //we're in progress/running
        self.evoObject.performOneGeneration()
            .then(function()
            {
                if(loopID < self.currentLoop)
                    return;
                //done another evo gen -- should be marked in genrerations inside evoobject

                //after we're done running a generation -- we need to check if we're all finished -- or to puase or whatever
                return qBackboneResponse("evolution:shouldEndEvolution", self.evoObject.generation, self.evoObject.population, self.evoObject.popEvaluations);
            })
            .then(function(shouldFinish)
            {
               if(loopID < self.currentLoop)
                return;
                // self.log("Should finish yo!".magenta);
                if(shouldFinish)
                {
                    self.evolutionInProgress = false;
                    self.evolutionRunning = false;
                    return self.evoObject.endEvolution();
                }
            })
            .then(function(endEvoObject)
            {
               if(loopID < self.currentLoop)
                 return;
                //if you are still in progress - schedule for a new loop
                if(self.evolutionRunning)
                    asyncCall(internalGenerationLoop, loopID)
                else
                    return qBackboneResponse("evolution:finishedEvolution", endEvoObject);
            })
            .then(function()
            {
                //nothing to do here
            })
            .fail(function(err)
            {
                if(loopID < self.currentLoop)
                 return;

             //otherwise, loop fail
                self.log("Internal Loop Fail: ", err)
                //have to throw whatever error happened here, probably not our fault!
                self.evoError(err);
            })


    }

    return self;
}




