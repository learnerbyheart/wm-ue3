var snowball = require('node-snowball'),
    stop_words=require('multi-stopwords')(['de']),
    should = require('should'),
    so = require('stringify-object'),
    mongo = require('../dbconnection/mongo-con.js'),
    natural = require("natural"),
    fs = require('fs'),
    path = require('path'),
    TRAINING_DATA_FILE_NAME = "recipes-train",
    TEST_DATA_FILE_NAME = "recipes-test",
    cheerio = require('cheerio'),   
    seedrandom = require('seedrandom'),
    loggerStream,
    logging = false,
    instruction = false,
    trainPerc = 0.9;


exports.prepareDocuments = function(n, onlyInstruction, callback, loggingOn){
    
    mongo.getDocuments(function(err, res) {
        if (loggingOn) {
          loggerStream = fs.createWriteStream(path.join(__dirname, 'results/') + 'ex2.txt', 'utf8');
          logging = true;
        }
        // res: [{text:"<html>...", label:TRUE}, {text:...}]
        if (!err) {
            console.log("Extract text from html...");

            // [{text:"the peter pan", label:TRUE}, {text:...}]
            var documents;
            if (onlyInstruction) {
                instruction = true;
                console.log('Use only recipe instruction text...');
                documents = getRecipeDivText(res); //alternativ
            } else {
                console.log('Use whole webpage text...');
                documents = getRecipeBodyText(res);
            }
            // [{words:["the", peter", "pan"], label:TRUE}, {words:...}]
            console.log("Build word list from text string...");
            var docWordLists = documentToWordList(documents);
            if (logging) loggerStream.write('1. Dokument zu Wort Liste\n'+so(docWordLists[0]));

            // [{words:"peter", "pan"], label:TRUE}, {words:...}]
            console.log("Stemming and stopwords...");
            docWordLists = stemAndStop(docWordLists);
            if(logging) loggerStream.write('2. Stoppwort-Filterung und Stemming\n'+so(docWordLists[0]));

            console.log("Split data randomly...");
            var randomSelection = selectTestTrainRandom(docWordLists, trainPerc);
            // [{words:["peter", "pan"], label:TRUE}, {words:...}]
            var trainDocWordLists = randomSelection.train;
            // [{words:["peter", "pan"], label:TRUE}, {words:...}]
            var testDocWordLists = randomSelection.test;

            if (logging) {
                // muss wegen der Nachvollziehbarkeit gemacht werden => kein Random
                trainDocWordLists = docWordLists.slice(0,500);
                testDocWordLists = docWordLists.slice(500,1000);
            }
            
            console.log("Calculate tfidf...");
            var tfidfResult = calcTfIdf(trainDocWordLists, testDocWordLists);
            // [{vec:{"peter":0.4, "pan":0.7}, label:TRUE}, {vec:...}]
            var trainFeatureVectors = tfidfResult.train;
            // [{vec:{"peter":0.4, "pan":0.7}, label:TRUE}, {vec:...}]
            var testFeatureVectors = tfidfResult.test;
            if (logging) loggerStream.write('3. Wort-Liste zu TF-IDF-Vektor\n'+so(trainFeatureVectors[0]));

            
            var dfObject = tfidfResult.df;
            
            console.log("Select features with highest df...");
            var featureSelectionResult = selectFeatures(trainFeatureVectors, testFeatureVectors, dfObject, n);
            if (logging) loggerStream.write('4. Einfache Feature-Selection\n'+so(featureSelectionResult.train[0]));            

            if(featureSelectionResult == false){
                callback(new Error("N is bigger than number of features!"));
            } else {
                // [{vec:{"pan":0.7, "peter":0.4}, label:TRUE}, {vec:...}]
                trainFeatureVectors = featureSelectionResult.train;
                // [{vec:{"pan":0.7, "peter":0.4}, label:TRUE}, {vec:...}]
                testFeatureVectors = featureSelectionResult.test;
                
                // Die Featurevektoren sind nun nach tfidf Relevanz absteigend sortiert, d.h.
                // alle Vektoren enthalten die gleichen Attribute in der gleichen Reihenfolge

                console.log("Save features sparse...");
                saveSparseDs(trainFeatureVectors,testFeatureVectors, n);
                saveSparseArff(trainFeatureVectors,testFeatureVectors, n);
                callback(null, true);
            }
        }
        if (logging) loggerStream.end();
    });
}

function calcWordAccuries(wordList) {
    var calcWordAccuriesMap = {};
    for (instance in wordList) {
        var words = instance.words,
            label = instance.label;
        for (word in words) {
            if (word in calcWordAccuriesMap) {
                if (label) {
                    calcWordAccuriesMap[word][1] = calcWordAccuriesMap[word][1] + 1;
                } else {
                    calcWordAccuriesMap[word][0] = calcWordAccuriesMap[word][0] + 1;
                }
            } else {
                if (label) {
                    calcWordAccuriesMap[word] = { 1 : 1, 0 : 0};
                } else {
                    calcWordAccuriesMap[word] = { 1 : 0, 0 : 1};
                } 
            }
        }
    }
    for (word in calcWordAccuriesMap) {

    }
    return calcWordAccuriesMap;
}

function selectFeaturesWithHighesAccuracy(trainDocWordLists, testDocWordLists, calcWordAccuriesMap) {
    var trainFeatureVectors,
        testFeatureVectors;

}

// Bedeutung der regex
// \w bedeutet sonderzeichen, underscores
// \s beduetet alle whitespaces
// /gi bedeutet global und case insensitive
// Problem.. er replaced auch die Umlaute :D
function getRecipeDivText(htmlDocuments) {
    var result = [];
    htmlDocuments.forEach(function(val, idx) {
        var $ = cheerio.load(val.text);

        //TODO brauchen wird das????
        $('script').remove();
        $('style').remove();
        
    	result.push({
    	   text : $('div#rezept-zubereitung').text().toLowerCase().replace(/[^\wäüöß]+/gi, ' ').replace(/[0-9]/g, "").replace(/\s+/g, ' '),
    	   label : val.italian
    	});
    	
    });
    return result;
}
// Bedeutung der regex
// ^ Verneinung
// \w bedeutet sonderzeichen, underscores
// \s beduetet alle whitespaces
// /gi bedeutet global und case insensitive
// Problem.. er replaced auch die Umlaute :D
function getRecipeBodyText(htmlDocuments) {
    var result = [];
    htmlDocuments.forEach(function(val, idx) {
        var $ = cheerio.load(val.text);
        $('script').remove();
        $('style').remove();
    
    	result.push({
    	   text : $('body').text().toLowerCase().replace(/[^\wäüöß]+/gi, ' ').replace(/[0-9]/g, "").replace(/\s+/g, ' '),
    	   label : val.italian
    	});
    });
    return result;
}

function documentToWordList(documents){
    var result = [],
        tokenizer = new natural.WordTokenizer();
    documents.forEach(function(val, idx) {
        result.push({
            words : tokenizer.tokenize(val.text),
            label : val.label
        });
    });
    return result;
}

//Wenden Sie auf die Liste von Wörtern Stoppwort-Filterung und Stemming an. 
//Beachten Sie zu Stemming die Hinweise am Ende. 
function stemAndStop(documents){
    var result = Array();
    // Iterate all documents
    for(var i=0; i<documents.length; i++){
        var curWords = documents[i].words;
        var resWords = Array();
        // Iterate all words in a document
        for(var j=0; j<curWords.length; j++){
            if(stop_words.indexOf(curWords[j]) == -1){
                //Wort ist kein Stopwort, speichere Wordstamm
                resWords.push(snowball.stemword(curWords[j], 'german'));
            } else {
                //Wort ist ein Stopwort -> wird ignoriert
            }
        }
        result.push({'words':resWords, 'label':documents[i].label});
    }
    return result;
}

function selectTestTrainRandom(docWordLists, trainPerc){
    var resTrain = Array();
    var resTest = Array();
    
    var shuffled = shuffle(docWordLists);
    
    for(var i=0; i< docWordLists.length; i++){
        if(i<(docWordLists.length * trainPerc)){
            resTrain.push(docWordLists[i]);
        } else{
            resTest.push(docWordLists[i]);
        }
    }
    return {test:resTest, train:resTrain};
}

function shuffle(array) {
    var randomat = seedrandom('myseed');
    var currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(randomat() * currentIndex);
        currentIndex -= 1;
    
        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
  }
  return array;
}

function calcTfIdf(trainDocs, testDocs){
    
    ///////////////////////////////////////////////
    // Calculate training data and save idf-Object
    ///////////////////////////////////////////////
    var tfTrainArray = Array();
    var idfObject = {};
    // Iterate through all documents
    for(var i=0; i<trainDocs.length; i++){
        var tf = {};
        var wordlist = trainDocs[i].words;
        // Iterate through all words in one document
        for(var j=0; j<wordlist.length; j++){
            // Update absolute term frequency
            if(tf.hasOwnProperty(wordlist[j])){
                tf[wordlist[j]] = tf[wordlist[j]] + 1;
            } else{
                tf[wordlist[j]] = 1;
            }
        }
        tfTrainArray.push(tf);
        // Iterate through all terms in one document
        for(var k=0, keys=Object.keys(tf); k<keys.length; k++){
            // Update document frequencies
            if(idfObject.hasOwnProperty(keys[k])){
                idfObject[keys[k]] = idfObject[keys[k]] + 1;
            } else{
                idfObject[keys[k]] = 1;
            }
            // Save relative frequency for each term
            tf[keys[k]] = tf[keys[k]] / wordlist.length;
        }
    }
    // Save df Object before making it idf
    // http://stackoverflow.com/questions/6089058/nodejs-how-to-clone-a-object
    var dfObjRes = JSON.parse(JSON.stringify(idfObject));
    // Iterate through all df terms and make them idf
    for(var l=0, keys=Object.keys(idfObject); l<keys.length; l++){
        // Save logarithmic inverted document frequency
        idfObject[keys[l]] = log(10, ((1+trainDocs.length) / idfObject[keys[l]]));
    }
    // Calculate and save the tfidf value for every term
    var tfIdfTrainArray = Array();
    for(var m=0; m<tfTrainArray.length; m++){
        var tfidf = {};
        for(var n=0, keys=Object.keys(tfTrainArray[m]); n<keys.length; n++){
            tfidf[keys[n]] = tfTrainArray[m][keys[n]] * idfObject[keys[n]];
        }
        tfIdfTrainArray.push(tfidf);
    }
    
    /////////////////////////
    // Calculate test data
    /////////////////////////
    
    var tfTestArray = Array();
    
    for(var i=0; i<testDocs.length; i++){
        var tf = {};
        wordlist = testDocs[i].words;
        // Iterate through all words in one document
        for(var j=0; j<wordlist.length; j++){
            // Update absolute term frequency
            if(tf.hasOwnProperty(wordlist[j])){
                tf[wordlist[j]] = tf[wordlist[j]] + 1;
            } else{
                tf[wordlist[j]] = 1;
            }
        }
        tfTestArray.push(tf);
        // Iterate through all terms in one document
        for(var k=0, keys=Object.keys(tf); k<keys.length; k++){
            // Save relative frequency for each term
            tf[keys[k]] = tf[keys[k]] / wordlist.length;
        }
    }
    
    var tfIdfTestArray = Array();
    
    for(var m=0; m<tfTestArray.length; m++){
        var tfidf = {};
        for(var n=0, keys=Object.keys(tfTestArray[m]); n<keys.length; n++){
            tfidf[keys[n]] = tfTestArray[m][keys[n]] * idfObject[keys[n]];
        }
        tfIdfTestArray.push(tfidf);
    }
    
    /////////////////////////////////
    // Concatenate the result object
    ////////////////////////////////
    
    var trainRes = Array();
    var testRes = Array();
    
    for(var p=0; p<trainDocs.length; p++){
        trainRes.push({'vec':tfIdfTrainArray[p], 'label':trainDocs[p].label});
    }
    for(var q=0; q<testDocs.length; q++){
        testRes.push({'vec':tfIdfTestArray[q], 'label':testDocs[q].label});
    }
    
    return {'train':trainRes, 'test':testRes, 'df':dfObjRes};
}

function log(base, number) {  
    return Math.log(number) / Math.log(base);  
}

// Ihr Programm sollte in der Lage sein, die relevantesten N Wörter (Features) zu selektieren. 
// Sortieren sie dabei einfach die Wörter nach ihrer Dokumenthäufigkeit im Trainingsset 
// und behalten sie die N häufigsten. 
function selectFeatures(trainFeatureVectors, testFeatureVectors, df, n){
    // Sort words in trainingSet according to document frequency
    var keysSorted = Object.keys(df).sort(function(a,b){return df[b]-df[a]});
    
    if(n > keysSorted.length){
        return false;
    }
    
    var trainRes = Array();
    var testRes = Array();
    // Save the training feature vectors with these keys
    for(var i=0; i<trainFeatureVectors.length; i++){
        var trainInstance = {};
        for(var j=0; j<n && j<keysSorted.length; j++){
            if(trainFeatureVectors[i].vec.hasOwnProperty(keysSorted[j])){
                trainInstance[keysSorted[j]] = trainFeatureVectors[i].vec[keysSorted[j]];
            } else {
                trainInstance[keysSorted[j]] = 0;
            }
        }
        trainRes.push({'vec':trainInstance, 'label':trainFeatureVectors[i].label});
    }
    // Save the test feature vectors with these keys
    for(var i=0; i<testFeatureVectors.length; i++){
        var testInstance = {};
        for(var j=0; j<n && j<keysSorted.length; j++){
            if(testFeatureVectors[i].vec.hasOwnProperty(keysSorted[j])){
                testInstance[keysSorted[j]] = trainFeatureVectors[i].vec[keysSorted[j]];
            } else {
                testInstance[keysSorted[j]] = 0;
            }
        }
        testRes.push({'vec':testInstance, 'label':testFeatureVectors[i].label});
    }
    // Concatenate result
    return {train:trainRes, test:testRes};
}

function saveSparseDs(trainFeatureVectors, testFeatureVectors, n){
  //  var trainingWriteStream = fs.createWriteStream(path.join(__dirname, '../classifier/data/') + TRAINING_DATA_FILE_NAME, 'utf8'),
    //    testWriteStream = fs.createWriteStream(path.join(__dirname, '../classifier/data/') + TEST_DATA_FILE_NAME, 'utf8'),
    var testFileString = '',
        trainingFileString = '';
    //write training set data to file
    trainFeatureVectors.forEach(function(val, idx) {
        if(val.label) {
            trainingFileString+='1';
            //testWriteStream.write("1");
            
        } else {
            trainingFileString+='0';
            //testWriteStream.write("0");
        }
        trainingFileString+=' ';
        //testWriteStream.write(" ");
        for (var index = 0, keys=Object.keys(val.vec); index<keys.length; index++) {
            if (val.vec[keys[index]]) {
                trainingFileString += index + ':' + val.vec[keys[index]] + " ";
               //testWriteStream.write(index + ":" + val.vec[keys[index]] + " ");
           }
        }
        trainingFileString+='\n';
        //testWriteStream.write("\n");
    });
    
    
    //write test set data to file
    testFeatureVectors.forEach(function(val, idx) {
        if(val.label) {
            testFileString+='1';
            //testWriteStream.write("1");
            
        } else {
            testFileString+='0';
            //testWriteStream.write("0");
        }
        testFileString+=' ';
        //testWriteStream.write(" ");
        for (var index = 0, keys=Object.keys(val.vec); index<keys.length; index++) {
            if (val.vec[keys[index]]) {
                testFileString += index + ':' + val.vec[keys[index]] + " ";
               //testWriteStream.write(index + ":" + val.vec[keys[index]] + " ");
           }
        }
        testFileString+='\n';
        //testWriteStream.write("\n");
    });
    if (instruction) {
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TRAINING_DATA_FILE_NAME + "-instruction-" + n + '-' + trainPerc + ".ds", trainingFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TEST_DATA_FILE_NAME + "-instruction-" + n + '-' + trainPerc + ".ds", testFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
    } else {
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TRAINING_DATA_FILE_NAME + "-" + n + '-' + trainPerc + ".ds", trainingFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TEST_DATA_FILE_NAME + "-" + n + '-' + trainPerc + ".ds", testFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
    }
//    trainingWriteStream.end();
//    testWriteStream.end();
    
}

function saveSparseArff(trainFeatureVectors, testFeatureVectors, n){
    var testFileString = '',
        trainingFileString = '',
        headerString = '',
        features;
    if (trainFeatureVectors.length < 1) {
        throw new Error("trainFeatureVector is empty");
    }
    headerString+='@relation recipes\n';
    features = Object.keys(trainFeatureVectors[0].vec);
    features.forEach(function(val, idx) {
        headerString+='@attribute ' + '"' + val + '"' + ' numeric\n'
    });
    headerString+='@attribute italian {1,0}\n'

    //write training set data to file
    trainingFileString+='@data\n';
    trainFeatureVectors.forEach(function(val, idx) {
        trainingFileString+='{ ';
        for (var index = 0, keys=Object.keys(val.vec); index<keys.length; index++) {
            if (val.vec[keys[index]]) {
                trainingFileString += index + ' ' + val.vec[keys[index]] + ",";
           }
        }
        if(val.label) {
            trainingFileString+=features.length + ' 1';
            
        } else {
            trainingFileString+=features.length + ' 0';
        }
        trainingFileString+='}\n';
        if (logging && idx === 0) loggerStream.write('5. Sparse-Repräsentation \n'+headerString+trainingFileString);            
    });
    
    
    //write test set data to file
    testFileString+='@data\n';
    testFeatureVectors.forEach(function(val, idx) {
        testFileString+='{ ';
        for (var index = 0, keys=Object.keys(val.vec); index<keys.length; index++) {
            if (val.vec[keys[index]]) {
                testFileString += index + ' ' + val.vec[keys[index]] + ",";
           }
        }
        if(val.label) {
            testFileString+=features.length + ' 1';
            
        } else {
            testFileString+=features.length + ' 0';
        }
        testFileString+='}\n';
    });
    if(instruction) {
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TRAINING_DATA_FILE_NAME + "-instruction-" + n + '-' + trainPerc + ".arff", headerString + trainingFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TEST_DATA_FILE_NAME + "-instruction-" + n + '-' + trainPerc + ".arff", headerString + testFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
    } else {
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TRAINING_DATA_FILE_NAME + "-" + n + '-' + trainPerc + ".arff", headerString + trainingFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        });   
        fs.writeFile(path.join(__dirname, '../classifier/data/') + TEST_DATA_FILE_NAME + "-" + n + '-' + trainPerc + ".arff", headerString + testFileString, function (err) {
            if (err) throw err;
            console.log('It\'s saved!');
        }); 
    }
//    trainingWriteStream.end();
//    testWriteStream.end();
    
}

/*
// Mocha tests for Textkit
describe('Testing Textkit', function(){
    it('Stopwords and Stemming', function(){
        var test = [{words:["Peter", "Fragen", "mit", "seinen", "Freunden", "Peter", "Pan", "und", "Hans", "Kochbücher", "Informationen","die", "roten", "Straßen"], label:true}];
        var result = [{words:["Peter", "Fragen", "Freund", "Peter", "Pan", "Hans", "Kochbuc", "Informat", "roten", "Strass"], label:true}];
        should.deepEqual(stemAndStop(test), result);
    });
    it('TfIdf', function(){
        var train = [{words:["this", "is", "a","a", "sample"], label:true}, {words:["this", "is", "another","another", "example","example","example"], label:true}];
        var test = [{words:["this", "is", "a","a", "sample"], label:true}, {words:["this", "is", "another","another", "example","example","example"], label:false}];
        var l2 = log(10, 2);
        var result = {train:[{vec:{"this":0,"is":0, "a":(2/5)*l2, "sample":(1/5)*l2}, label:true}, {vec:{"this":0,"is":0, "another":(2/7)*l2, "example":(3/7)*l2}, label:true}], test:[{vec:{"this":0,"is":0, "a":(2/5)*l2, "sample":(1/5)*l2}, label:true}, {vec:{"this":0,"is":0, "another":(2/7)*l2, "example":(3/7)*l2}, label:false}], df:{"this":2, "is":2, "a":1, "sample":1, "another":1, "example":1}};
        should.deepEqual(calcTfIdf(train, test), result);
    });
    it('Random Selection', function(){
        var train = [{words:"one", label:true},{words:"two", label:true}, {words:"three", label:true}, {words:"four", label:true}, {words:"five", label:true}];
        .log(selectTestTrainRandom(train));
    });
});*/
