
var Q = require('q');

var ranking = require('./rank.js');
	
var wUtils = require('win-utils');
var wMath = wUtils.math;


module.exports = evoContainer;

function evoContainer(evoProps, localConfig, backEmit, log)
{
	var self = this;

	//add emit functionality to self
    self.population = [];
    self.generation = 0;
    //don't change popEval dictionary ever
    //it is passed to ranking object
    self.popEvaluations = {};

	//save geno type and log stuff
	self.genomeType = evoProps.genomeType;
	self.defaultFitness = evoProps.defaultFitness || 0.00001;
	self.tournamentSize = evoProps.tournamentSize || 3;

	//assumed 10% elitism
	self.elitismProportion = evoProps.elitismProportion || .1;
	//assumed 50/50 asexual/sexual
	self.asexualProportion = evoProps.asexualProportion || (1- (evoProps.sexualProportion || .5));
	self.sexualProportion = evoProps.sexualProportion || (1 - self.asexualProportion);

	//prop sum chekc -- should be 1 exactly
	var propSum = self.asexualProportion + self.sexualProportion;
	if(propSum != 1)
	{
		//readjust for weird proportion behavior -- resets to being fractions summing to 1!
		self.asexualProportion = self.asexualProportion/propSum;
		self.sexualProportion = self.sexualProportion/propSum;
	}

	self.log = log;
	self.backEmit = backEmit;

    //pass our q function for backbone emit calls -- don't need to keep redefining it
	self.multiobjective = new ranking(self.popEvaluations, self.backEmit, log);

    //what do we need to monitor for every object in the population
   	var emptyEvaluation = function()
    {
    	//some measure of complexity for that encoding type
        return {age: 0, fitness: 0.000001, realFitness: 0.000001, behaviors: [], complexity: 0};
    }
    var mergeEvalIntoObject = function(fromEval, toEval)
    {
        for(var key in fromEval)
        {
            toEval[key] = fromEval[key];
        }

        //make sure some defaults exists
    	toEval.fitness = Math.max(toEval.fitness || 0, self.defaultFitness);
    	toEval.realFitness = Math.max(toEval.realFitness || 0, self.defaultFitness);
    	toEval.behaviors = toEval.behaviors || [];
    	toEval.complexity = toEval.complexity || 0;
    }

    self.clearSessionObject = function()
    {
        self.sessionObject = {};
    }
     self.createOffSpring = function()
    {
    	//gunna get to this, we swear
        var defer = Q.defer();

        self.clearSessionObject();

        //We don't do any of this -- the encodings responsible will handle augmenting the session object
        //when we clear session info, we're also destroying anything done by other encodings -- it's like reset for everyone
        // Create a new lists so that we can track which connections/neurons have been added during this routine.
        // self.sessionObject.newConnectionTable = [];
        // self.sessionObject.newNodeTable = [];

        //lets create a list of parents we want for creating artifacts
        var eliteCount = Math.floor(self.elitismProportion*self.population.length);
       
        //how many to create
        var nonElite = self.population.length - eliteCount;

        //select how many are asexual
        var asexual = Math.floor(self.asexualProportion*nonElite);
        //the rest are sexual offspring
        var sexual = nonElite - asexual;

        //life is hard as a single parent -- this is just the offspring from asexual reproduction
        var singleParents = self.selectSingleParents(asexual);
        //need parents chosen through tournament selection/some type of mating routine
        //if for whatever unknown reason you are rocking a pop size of 1 (what are you doing?), we use asexual reproduction -- duh
        var sexyParents = (self.population.length > 1) ? self.selectSexualParents(sexual) : self.selectSingleParents(sexual);

        //merge the two parent lists
        var parentIxs = singleParents.concat(sexyParents);

        //now we have our desired parents for offspring creation, we return the offspring objects
        //we must force these parents (and track new nodes/connections), so we pass a session object to create artifacts
        self.sessionObject.forceParents = parentIxs;

        //send them to the generator -- more power!
        //we need to generate as many objects as we have parent lists, we pass in the full population, as well as the force parents object in session
        self.backEmit.qCall("generator:createArtifacts", self.genomeType, parentIxs.length, self.population, self.sessionObject)
            .then(function(offspringObject)
            {
                //these are our new population of objects! Created from our parents :)
                var offspring = offspringObject.offspring;

                //now we have our offspring all ready for next step
                defer.resolve(offspring);
            })
            .fail(function(err)
            {
            	defer.reject(err);
            });


        return defer.promise;
    };

    self.selectSingleParents = function(count)
    {
    	var p = [];
    	var popLength = self.population.length;
    	for(var i=0; i < count; i++)
    	{
    		var inner = [wMath.next(popLength)];
    		p.push(inner);
    	}

    	//return an array of arrays of length 1 
    	//used for parent selection
    	return p;
    }
    self.selectSexualParents = function(count)
    {
    	var p = [];
    	var popLength = self.population.length;
    	for(var i=0; i < count; i++)
    	{
    		var inner, parent1, parent2;

		 	//tournament select in multiobjective search
            parent1 = self.tournamentSelect(self.population);

         	// Select the 2nd parent from the whole popualtion (there is a chance that this will be the same artifact
            var j=0;
            do
            {
                parent2  = self.tournamentSelect(self.population);
            }
            while(parent1.ix==parent2.ix && j++ < 4);

            //we found two different objects!
            if(parent1.ix != parent2.ix)
            {
            	inner = [parent1.ix, parent2.ix];
            }
            else
            	inner = [parent1.ix];

            //either we have a single object selected, or two -- either way, add it to the pile
    		p.push(inner);
    	}

    	//return an array of arrays of length 1 
    	//used for parent selection
    	return p;
    }
    self.shutDown = function()
    {
        self.isShutDown = true;
    }
    self.performOneGeneration = function()
    {
    	//gunna get to this, we swear
        var defer = Q.defer();

        //No speciation in multiobjective
        //therefore no species to check for removal

        //----- Stage 1. Create offspring / cull old genomes / add offspring to population.

        //send population (along with known eval information) -- can use this for ranking
        self.multiobjective.addPopulation(self.population, self.popEvaluations);

        //ranking is now an async process -- we need to call someone to measure our evaluations 
        self.multiobjective.rankGenomes()
            .then(function()
            {
                if(self.isShutDown)
                    return;
                //finished ranking genomes

                //cut the population down to the desired size -- use the rankings to sort and cut
                self.multiobjective.truncatePopulation(self.population.length);

                //no speciation necessary
                //keep the numbers in line -- you know how unruly they get
                self.updateFitnessStats();

                //let's make some babies
                return self.createOffSpring();
            })       
        	.then(function(offspring)
        	{
                if(self.isShutDown)
                    return;
        		//we need to trim population to the elite count, then replace
		        //however, this doesn't affect the multiobjective population -- just the population held in search at the time

                //sort our pop objects please
                ranking.SortPopulation(self.population, self.popEvaluations);

                //how many are kept simply for being good
		        var eliteCount = Math.floor(self.elitismProportion*self.population.length);

		        //remove everything but the most elite!
		        self.population = self.population.slice(0, eliteCount);

                //now remove the excess evaluations
                var mergePops = self.population.concat(self.multiobjective.activePopulation);

                var allKeys = {};
                //pull the leftover evaluations from the former eval object (pEvals)
                for(var i=0; i < mergePops.length; i++)
                {
                    allKeys[mergePops[i].wid] = true;
                }

                //to prevent bloating over many generations, we trim the pop eval dictionary to not have useless eval objects
                var evalKeys = Object.keys(self.popEvaluations);
                for(var i=0; i < evalKeys.length; i++)
                {
                    var key = evalKeys[i];
                    //if we don't have this key in our current pop, or the multiobjective pop
                    //you can remove it from evaluation objects
                    if(!allKeys[key])
                        delete self.popEvaluations[key];
                }

		        //Add offspring to the population.
		        var genomeBound = offspring.length;
		        for(var genomeIdx=0; genomeIdx<genomeBound; genomeIdx++)
                {
                    var gObj = offspring[genomeIdx];
		            self.population.push(gObj);
                    //set the offspring up with an empty evaluation
                    self.popEvaluations[gObj.wid] = emptyEvaluation();
                }

		        //----- Stage 2. Evaluate genomes / Update stats.
		        return self.evaluatePopulation();
		    })
		    .then(function()
		    {
                if(self.isShutDown)
                {
                    defer.resolve();
                    return;
                }
		    	//update our stats now, all done with evals
		    	self.updateFitnessStats();

		    	//we've all gotten just a bit older, wouldn't you say?
		        self.incrementAges();

		        //increment gen count as well -- happy birthday
		        self.generation++;

		        //also, we're done with this function
		        defer.resolve();

        	})
        	.fail(function(err)
        	{
        		defer.reject(err);
        	})        

        //i will not fail you, probably
        return defer.promise;

    };


  	self.evaluatePopulation= function()
    {
    	//gunna get to this, we swear
        var defer = Q.defer();

        //default everyone is evaluated
        if(!self.backEmit.hasListeners("evaluate:evaluateArtifacts"))
            throw new Error("No evaluation function defined, how are you supposed to run evolution?");

        //ask the backbone for some help evaluating -- not the responsibility of evolution, yo
        self.backEmit.qCall("evaluate:evaluateArtifacts", self.population)
        	.then(function(evalObject)
        	{
                if(!evalObject || !evalObject.evaluations || evalObject.evaluations.length != self.population.length)
                    throw new Error("Evaluate Artifacts must return an object with evaluations property of type [array] and length [" + self.population.length +"]");

        		var evaluations = evalObject.evaluations;


        		for(var i=0; i < evaluations.length; i++)
        		{
        			//fetch relevant objects 
        			var realEval = evaluations[i];
        			var pObj = self.population[i];
        			var pEval = self.popEvaluations[pObj.wid];

                    // self.log("Real: ", evaluations[i], " obj: ", pObj, " peval: ", pEval);

        			//merge the evaluation object into our existing!
        			mergeEvalIntoObject(realEval, pEval);


        			//our eval work here is done, friend.
        		}

        		//evaluations incorporated into the population -- thank the heavens
        		defer.resolve();
        	})
        	.fail(function(err)
        	{
                self.log("Fail catch: ", err.stack);
        		defer.reject(err);
        	})

    	//send back a notice that we're really gonna do this eventually, no worries
        return defer.promise;
    };

	//now lets get started
	self.createInitialPopulation = function(evoProps, seeds)
	{
        var defer = Q.defer();

        var popSize = evoProps.populationSize;

        if(!popSize)
            throw new Error("Can't initialize population with no size. NSGA-II error.")

        //Reset session object, for the children's sake.
        self.clearSessionObject();

        //first thing is to take our seeds and create a bunch of new objects
        //todo: want to send specific request
        self.backEmit.qCall("generator:createArtifacts", self.genomeType, popSize, seeds)
            .then(function(offspringObject)
            {
                //these are our new population of objects! Created from our seeds :)
                var offspring = offspringObject.offspring;

                //We can declare our initial population as these objects
                self.population = offspring;

                //need population properties to match our population objects -- we use the id map
                for(var i=0; i < offspring.length; i++)
                    self.popEvaluations[offspring[i].wid] = (emptyEvaluation());

                //we have to evaluate our initial objects before proceeding
                return self.evaluatePopulation();
            })
            .fail(function(err)
            {
            	defer.reject(err);
            })
            .done(function()
            {
                //gotta resolve at some point!
                defer.resolve();
            })

        return defer.promise;
	}


    self.endEvolution = function()
    {
        //probably a lot to clean up here -- also, might be interested in doing some saving as well
        var defer = Q.defer();

        //we need to clean up all our junk
        self.multiobjective.addPopulation(self.population, self.popEvaluations);

        //we should rank the individuals being sent back as the last population though!        
        self.multiobjective.rankGenomes()
            .then(function()
            {

                //remove excess objects from popEvaluations
                self.multiobjective.sortPopulation();

                // self.multiobjective.truncatePopulation(self.population.length);
                // for(var i=0; i < self.multiobjective.activePopulation.length; i++)
                // {
                //     var iPop = self.multiobjective.activePopulation[i];
                //     self.log("Ending evo: ".rainbow, self.popEvaluations[iPop.wid]);

                // }
                //for now, we just return our current population and the evaluations
                //in reality, we should be searching our archive for most interesting objects 
                //that's outside the scope of the nsga algorithm though
                defer.resolve({population: self.multiobjective.activePopulation, evaluations: self.popEvaluations});
            })
            .fail(function(err)
            {
                //oops, error ranking genoems before the end
                defer.reject(err);
            })
      

        return defer.promise;
    }



 	self.incrementAges = function()
    {
        //would normally increment species age as  well, but doesn't happen in multiobjective
        for(var key in self.popEvaluations)
        {
            var ng = self.popEvaluations[key];
            ng.age++;
        }
    };

 	self.updateFitnessStats = function()
    {
        self.bestFitness = Number.MIN_VALUE;
        self.bestGenomeID = null;
        self.totalFitness = 0;
        self.avgComplexity = 0;
        self.meanFitness =0;

		self.totalComplexity = 0; 		

        //go through our evaluations -- sum up complexity and choose champ
 		for(var key in self.popEvaluations)
        {
            var evalInfo = self.popEvaluations[key];

          	if(evalInfo.realFitness > self.bestFitness)
            {
                self.bestFitness = evalInfo.realFitness;
                self.bestGenomeID = key;
            }
            //add up complexity measure
            self.totalComplexity += evalInfo.complexity;

            //pull the fitness sum
            self.totalFitness += evalInfo.realFitness;
        }

        self.avgComplexity = self.totalComplexity/self.population.length;
        self.meanFitness = self.totalFitness/self.population.length;
    };

    self.tournamentSelect = function(genomes)
    {
        var bestFound= 0.0;
        var bestGenome=null;
        var selIx = -1;
        var bound = genomes.length;

        //grab the best of 4 by default, can be more attempts than that
        for(var i=0;i<self.tournamentSize;i++) {
        	var genomeIx = wMath.next(bound);
            var next= genomes[genomeIx];
            var evalInfo = self.popEvaluations[next.wid];
            if(!evalInfo)
            	throw new Error("tournamentSelect fails without WID information, cannot fetch from evaluation objects.");

            if (evalInfo.fitness > bestFound) {
                bestFound=evalInfo.fitness;
                bestGenome=next;
                selIx = genomeIx; 
            }
        }

        return {genome: bestGenome, ix: selIx};
    };




	return self;
}





