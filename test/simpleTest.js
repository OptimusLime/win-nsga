//here we test the insert functions
//making sure the database is filled with objects of the schema type

var assert = require('assert');
var should = require('should');
var colors = require('colors');
var traverse = require('optimuslime-traverse');
var Q = require('q');

var util = require('util');

var winnsga = require('../');
var wMath = require('win-utils').math;
var winback = require('win-backbone');

var backbone, generator, backEmit, backLog;
var evoTestEnd;
var count = 0;

var emptyModule = 
{
	winFunction : "test",
	eventCallbacks : function(){ return {}; },
	requiredEvents : function() {
		return [
			"evolution:nsga-startEvolution"
			];
	}
};
var cIx = 0;
//sample encoding that known how to create its own children -- randomly clone a parent
var sampleEncoding = 
{
	winFunction : "encoding",
	encodingName : "sample",
	sampleSchema : {
		value : "string"
	},
	eventCallbacks : function()
	{ 
		return {
			"encoding:sample-createFullOffspring" : function(genProps, parentProps, override, done) { 
				// backLog('called create full offspring ', override ? override.forceParents : ""); 
				var parents = parentProps.parents;
				var count = genProps.count;

				var allParents = [];
				var children = [];

				for(var c=0; c < count; c++)
				{
					var ixs = [];
					var pIx = wMath.next(parents.length);
					var rOffspring = traverse(parents[pIx]).clone();									
					rOffspring.value = parents[pIx].value.split("-")[0] + "-" + cIx + "-" + c;
					// rOffspring.second = "This will be erased.";

					ixs.push(pIx);
					children.push(rOffspring);
					allParents.push(ixs);
				}

				cIx++;
				//done, send er back
				done(undefined, children, allParents);

			 	return; 
			 }
		};
	},
	requiredEvents : function() {
		return [
		"schema:addSchema",
		"generator:createArtifacts"
		];
	},
	initialize : function(done)
    {
    	backLog("Init encoding");

    	var emitter = backbone.getEmitter(sampleEncoding);
        emitter.emit("schema:addSchema", sampleEncoding.encodingName, sampleEncoding.sampleSchema, function(err)
        {
        	if(err){
        		done(new Error(err));
        		return;
        	}

        	done();
	
        })
    }
};

//handle the evaluation!
var sampleEvaluate = {
	winFunction : "evaluate",
	eventCallbacks : function()
	{ 
		return {
			"evaluate:evaluateArtifacts" : function(population){
				// throw new Error("evaluateArtifacts: Not implemented");
				var done = arguments[arguments.length-1];
				var popEvals = {};

				var evals = [];
				//we do stuff with the population, or with the objects 
				//this is where we would use novelty or genomic novelty or whatever
				for(var i=0; i < population.length; i++)
				{
					evals.push({realFitness: i, behaviors : []});//[Math.random(), Math.random(), Math.random()]});
				}

				done(undefined, {evaluations: evals});
			}
			,"evaluate:measureObjectives":function(population, popEvaluations)
			{

				var done = arguments[arguments.length-1];

				//for measuring the objectives of all the pop objects
				var measured = [];

				//we do stuff with the population, or with the objects 
				//this is where we would use novelty or genomic novelty or whatever
				for(var i=0; i < population.length; i++)
				{
					measured.push([Math.random(), Math.random()]);
				}

				done(undefined, measured);
			}
		}
	},
	requiredEvents : function() {
		return [];
	}
};

var maxGens = 2;
var sampleEvolution = {
	winFunction : "evaluate",
	eventCallbacks : function()
	{
		return {
			"evolution:shouldEndEvolution" : function(gens)
			{
				backLog("Gen Count: " + gens);

				var done = arguments[arguments.length-1];

				if(gens < maxGens)
					done(undefined, false);
				else
					done(undefined, true);

			},
			"evolution:finishedEvolution" : function(pop, eval)
			{
				var done = arguments[arguments.length-1];

			
				done();
				//end callback if it exists
				if(evoTestEnd)
					evoTestEnd.apply(this, arguments);
			}
		};
	},
	requiredEvents : function() {
		return [];
	}
};

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
    backEmit.apply(backEmit, augmentArgs);

    return defer.promise;
}


describe('Testing win-NSGA running -',function(){

    //we need to start up the WIN backend
    before(function(done){

    	//do this up front yo
    	backbone = new winback();


    	var sampleJSON = 
		{
			"win-nsga" : winnsga,
			"win-gen" : "win-gen",
			"win-schema" : "win-schema",
			"sample-encoding" : sampleEncoding,
			"evaluate" : sampleEvaluate,
			"evolution" : sampleEvolution,
			"test" : emptyModule
		};
		var configurations = 
		{
			"global" : {
			},
			"win-nsga" : {
				genomeType : "sample"
				,logLevel : backbone.testing
			},
			"win-gen" : {
				"encodings" : [
					"sample"
				]
				,validateParents : true
				,validateOffspring : true
				// ,logLevel : backbone.testing
			},
			"win-schema" : {
				multipleErrors : true
				// ,logLevel : backbone.testing

			},
			"stuff" :
			{
				
			}
		};

    	backbone.logLevel = backbone.testing;

    	backEmit = backbone.getEmitter(emptyModule);
    	backLog = backbone.getLogger({winFunction:"mocha"});
    	backLog.logLevel = backbone.testing;

    	//loading modules is synchronous
    	backbone.loadModules(sampleJSON, configurations);

    	var registeredEvents = backbone.registeredEvents();
    	var requiredEvents = backbone.moduleRequirements();
    		
    	backLog('Backbone Events registered: ', registeredEvents);
    	backLog('Required: ', requiredEvents);

    	backbone.initializeModules(function()
    	{
    		backLog("Finished Module Init");
 			done();
    	});

    });

    it('Should run evolution for 10 generations',function(done){

    	var exampleSeeds = [
    		{ value : "nothing"
    		,wid : "012345", parents : [], dbType : "sample"
    		},
    		{ value : "something"
    		,wid : "543210", parents : [], dbType : "sample"
    		}
    		// {"simple" : "stuff", "more" : "things"}
    	];

    	var evoProps = {genomeType : "sample", populationSize : 10};

    	//throw errors while running evolution
    	var evoError = function(err)
    	{
    		if(typeof err == "string")
    			done(new Error(err));
    		else
    			done(err);
    	};

    	evoTestEnd = function(popObject)
    	{
    		var pop = popObject.population;
    		var eval = popObject.evaluations;

			for(var i=0; i < pop.length; i++)
			{
				var singleEval = eval[pop[i].wid];

				backLog("Final Eval: ".magenta,  singleEval);
			}

    		// backLog("Objs: ", util.inspect(arguments[0].population, false, 10));
    		// backLog("Evals: ", util.inspect(arguments[0].evaluations, false, 10));
    		// backLog("Evals: ", util.inspect(arguments[1], false, 10));
    		//finished evolution 
    		done();
    	}

    	//now we call asking for 
    	qBackboneResponse("evolution:nsga-startEvolution", evoProps, exampleSeeds, evoError)
    		.then(function(artifacts)
    		{
    			//evolution started!
    			backLog('\tFinished starting evolution, '.cyan, util.inspect(artifacts, false,10));
		    	// done();   
    		})
    		.fail(function(err)
    		{
    			if(err.errno)
    				done(err);
    			else
    				done(new Error(err.message));
    		});
    
    });
});



