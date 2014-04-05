var Q = require('q');
module.exports = multiobjective;


//information to rank each genome
function RankInfo()
{
    var self = this;

    //when iterating, we count how many genomes dominate other genomes
    self.dominationCount = 0;
    //who does this genome dominate
    self.dominates = [];
    //what is this genome's rank (i.e. what pareto front is it on)
    self.rank = 0;
    //has this genome been ranked
    self.ranked = false;

    //just a quick reset of all the variables
    self.reset = function(){
        self.rank = 0;
        self.ranked = false;
        self.dominationCount = 0;
        self.dominates = [];
    };

    //send me back, boss
    return self;
};
//create sort population function
function SortPopulation(pop, popEvals)
{
	// console.log("First: ", pop);
    //sort genomes by fitness / age -- as genomes are often sorted
    //higher fitness, younger age wins
    pop.sort(function(x,y){
    	var xeval = popEvals[x.wid];
    	var yeval = popEvals[y.wid];

        var fitnessDelta = yeval.fitness - xeval.fitness;
        if (fitnessDelta < 0.0)
            return -1;
        else if (fitnessDelta > 0.0)
            return 1;

        var ageDelta = xeval.age - yeval.age;

        // Convert result to an int.
        if (ageDelta < 0)
            return -1;
        else if (ageDelta > 0)
            return 1;

        return 0;

    });
    // for(var i=0; i < pop.length; i++)
        // console.log("Tehn :".red, pop[i].wid, " eval: ".magenta, popEvals[pop[i].wid]);
};


//class to assign multiobjective fitness to individuals (fitness based on what pareto front they are on)
function multiobjective(activeEvals, backEmit, log)
{
    var self = this;
    
    self.backEmit = backEmit;
    self.qEmit = backEmit.qCall;
    self.log = log;

    self.popSorted = false;
    self.activeIDs = {};
    self.activePopulation = [];
    self.activeEvaluations = activeEvals;
    self.ranks = [];

    //if genome x dominates y, increment y's dominated count, add y to x's dominated list
    self.updateDomination = function(x,  y,  r1, r2)
    {
        if(self.dominates(x,y)) {
            r1.dominates.push(r2);
            r2.dominationCount++;
            // self.log("\t\nX Dominates".magenta, x.objectives, "\t\nY:".red, y.objectives);
        }
        // else
            // self.log("\t\nX Does Not Dominate".red, x.objectives, "\t\nY:".cyan, y.objectives);

    };

    //function to check whether genome x dominates genome y, usually defined as being no worse on all
    //objectives, and better at at least one
    self.dominates = function(x,  y) {
        var better=false;
        var objx = x.objectives, objy = y.objectives;

        var sz = objx.length;

        //if x is ever worse than y, it cannot dominate y
        //also check if x is better on at least one
        for(var i=0;i<sz-1;i++) {
            if(objx[i]<objy[i]) return false;
            if(objx[i]>objy[i]) better=true;
        }

        //genomic novelty check, disabled for now
        //threshold set to 0 -- Paul since genome is local
        var thresh=0.0;
        if((objx[sz-1]+thresh)<(objy[sz-1])) return false;
        if((objx[sz-1]>(objy[sz-1]+thresh))) better=true;

        return better;
    };

    //distance function between two lists of objectives, used to see if two individuals are unique
    self.distance = function(x, y) {
        var delta=0.0;
        var len = x.length;
        for(var i=0;i<len;i++) {
            var d=x[i]-y[i];
            delta+=d*d;
        }
        return delta;
    };

    //add an existing population from hypersharpNEAT to the multiobjective population maintained in
    //this class, step taken before evaluating multiobjective population through the rank function
    self.addPopulation = function(genomes)
    {
    	//add unique genomes to our population
        for(var i=0;i< genomes.length;i++)
        {
            var blacklist=false;
			var wid = genomes[i].wid;
            //no duplicates please
            if(self.activeIDs[wid])
                blacklist = true;

            //add genome if it is unique
            //we might not need to make copies    
            if(!blacklist) {
                //push directly into population, don't use copy -- should test if this is a good idea?
                self.activePopulation.push(genomes[i]);
                self.activeIDs[wid] = genomes[i];
            }
        }
        //no longer sorted by fitness/age
        self.popSorted = false;
    };

    self.sortPopulation = function()
    {
    	if(!self.popSorted)
    	{
    		SortPopulation(self.activePopulation, self.activeEvaluations);
    		self.popSorted = true;
    	}
    }

    //when we merge a population or two together, often the population will overflow, and we need to cut
    //it down. to do so, we just remove the last x individuals, which will be in the less significant
    //pareto fronts
    self.truncatePopulation = function(size)
    {
        var toRemove = self.activePopulation.length - size;
        self.log("population size before: " + self.activePopulation.length, " Removing: ", toRemove);

        //remove the tail after sorting
        if(toRemove > 0)
        {
        	//sorts population if necessary
        	self.sortPopulation();

        	//now we have to remove everything that does us no good
        	//this means at position size, remove toRemove length of items
        	//this should clear the bottom of the list IN PLACE
            self.activePopulation.splice(size, toRemove);
        }

        //changes to population, make sure to update our lookup
        self.log("population size after: " + self.activePopulation.length);

        return self.activePopulation;
    };

    self.rankGenomes = function()
    {
    	var defer = Q.defer();

    	var population = self.activePopulation;
    	var evaluations = self.activeEvaluations;

    	//what's the pop size, how many are we ranking
        var size = population.length;

        self.qEmit("evaluate:measureObjectives", population, evaluations)
        	.then(function(objectiveList)
        	{
        		if(!objectiveList || objectiveList.length != population.length)
        			throw new Error("Measure Objectives must return an array equal to the size of the population measured.");

        		//have to apply the objectives to our list of evaluations
        		for(var i=0; i < objectiveList.length;i++)
        		{
		        	//pull the wid of the object
		        	var iWID = population[i].wid;

		        	//set the objectives to be the objectives passed back
		        	evaluations[iWID].objectives = objectiveList[i];

		        	// self.log("Rank Eval: ".cyan, iWID, " : ", self.activeEvaluations[iWID]);
        		}

        		 //reset rank information
		        for(var i=0;i<size;i++) {
		            if(self.ranks.length<i+1)
		                self.ranks.push(new RankInfo());
		            else
		                self.ranks[i].reset();
		        }

		        //calculate domination by testing each genome against every other genome
		        for(var i=0;i<size;i++) {
		        	//pull the wid of the object
		        	var iWID = population[i].wid;

		        	// self.log("\n\nExamining: ".green, iWID);

		            for(var j=0;j<size;j++) {
		            	var jWID = population[j].wid;
		            	//send in evaluations for both genomes -- which will then update the rankings
		            	//don't rank against yourself -- what a silly waste
		            	if(iWID != jWID)
		                	self.updateDomination(evaluations[iWID], evaluations[jWID],self.ranks[i],self.ranks[j]);
		            }
		        }

		        //successively peel off non-dominated fronts (e.g. those genomes no longer dominated by any in
		        //the remaining population)
		        var front = [];
		        var ranked_count=0;
		        var current_rank=1;
		        while(ranked_count < size) {
		            //search for non-dominated front
		            for(var i=0;i<size;i++)
		            {
		                //continue if already ranked
		                if(self.ranks[i].ranked) continue;
		                //if not dominated, add to front
		                if(self.ranks[i].dominationCount==0) {
		                    front.push(i);
		                    self.ranks[i].ranked=true;
		                    self.ranks[i].rank = current_rank;
		                }
		            }

		            var front_size = front.length;
		            self.log("Front " + current_rank + ", size: " + front_size);

		            //now take all the non-dominated individuals, see who they dominated, and decrease
		            //those genomes' domination counts, because we are removing this front from consideration
		            //to find the next front of individuals non-dominated by the remaining individuals in
		            //the population
		            for(var i=0;i<front_size;i++) {
		                var r = self.ranks[front[i]];
		                for (var z=0; z < r.dominates.length; z++) {
		                	var dominated = r.dominates[z];
		                    dominated.dominationCount--;
		                }
		            }

		            ranked_count+=front_size;
		            front = [];
		            current_rank++;
		        }

		        //fitness = popsize-rank (better way might be maxranks+1-rank), but doesn't matter
		        //because speciation is not used and tournament selection is employed
		        for(var i=0;i<size;i++) {
		        	var pWID = population[i].wid;
		            evaluations[pWID].fitness = (size+1)-self.ranks[i].rank;
		    	}

		    	//new fitness values -- everything is fair sort game now!
		    	self.popSorted = false;

		        //sorting based on "fitness"/age -- fitness = rank
		        self.sortPopulation();



	      //     	for(var i=0;i<size;i++) {
		     //    	var pWID = population[i].wid;
       //  		    self.log("Full evals with rank: ".red, evaluations[pWID]);

		    	// }
		    


		        //after sorting, there is nothing left to remark about
		        defer.resolve();
        	})
        	.fail(function(err)
        	{
        		defer.reject(err);
        	});

    	return defer.promise;	

       
    };


    //send it on back yo
    return self;
};

multiobjective.SortPopulation = SortPopulation;




