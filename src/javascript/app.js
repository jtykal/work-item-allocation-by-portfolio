Ext.define("work-item-allocation-by-portfolio", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'display_box', tpl: '<div class="no-data-container"><div class="secondary-message">{message}</div></div>'}
    ],

    integrationHeaders : {
        name : "work-item-allocation-by-portfolio"
    },

    config: {
        defaultSettings: {
            portfolioItemType: null,
            strictReleaseFilter: false,
            releaseStartDate: null,
            releaseEndDate: null,
            calculationType: "count"
        }
    },
    exportDebug: false,
    MAX_FILTERS: 50,
    chartColors: [
        Rally.util.Colors.grey5,
        Rally.util.Colors.brick,
        Rally.util.Colors.lime,
        Rally.util.Colors.blue,
        Rally.util.Colors.yellow,
        Rally.util.Colors.green,
        Rally.util.Colors.orange,
        Rally.util.Colors.pink,
        Rally.util.Colors.purple,
        Rally.util.Colors.teal,
        Rally.util.Colors.red_med,
        Rally.util.Colors.lime_med,
        Rally.util.Colors.cyan,
        Rally.util.Colors.blue_lt,
        Rally.util.Colors.yellow_med,
        Rally.util.Colors.orange_med,
        Rally.util.Colors.pink_med,
        Rally.util.Colors.purple_med,
        Rally.util.Colors.teal_med,
        Rally.util.Colors.red_lt
    ],

    launch: function() {
        this.fetchPortfolioItemTypes().then({
            success: this.initializeApp,
            failure: this.showErrorNotification,
            scope: this
        });
    },

    initializeApp: function(portfolioItemTypes){
        this.portfolioItemTypes = portfolioItemTypes;
        if (this.validateSettings()){
            this.updateView();
        }
    },

    validateSettings: function(){
        this.logger.log('validateSettings()');
        if (!this.getSetting('portfolioItemType') || this.getPIBucketLevel() < 0){
            this.getDisplayBox().update({message: "Please configure a Portfolio Item Type in the App Settings."});
            return false;
        };
        if (!this.getContext().getTimeboxScope() && (!this.getSetting('releaseStartDate') || !this.getSetting('releaseEndDate'))) {
            this.getDisplayBox().update({message: "Please configure Release Start/End Dates in the App Settings."});
            return false;
        }
        return true;
    },

    getDisplayBox: function(){
        return this.down('#display_box');
    },

    getFilters: function(){
        var filters;
        var timebox_scope = this.getContext().getTimeboxScope();
        var startDate, endDate;

        if (timebox_scope) {
            if (this.getSetting('strictReleaseFilter') == true) {
                this.logger.log('EXPLICIT RELEASE FILTERS');
                filters = [
                    {
                        property: 'DirectChildrenCount',
                        value: 0
                    }
                ];
                // Filters for explicit inclusion of work items based on Release setting
                filters.push(timebox_scope.getQueryFilter());
                if (filters.length > 1){
                    filters = Rally.data.wsapi.Filter.and(filters);
                }
                return(filters);
            };

            // GET DATES FROM THE RELEASE TIMEBOX
            this.logger.log('IMPLICIT RELEASE DATE FILTERS');
            var release_data = timebox_scope.record.getData();
            //this.logger.log('release_data: ', release_data);
            startDate = release_data.ReleaseStartDate;
            endDate = release_data.ReleaseDate;

            //get dates into a valid format for Rally API query
            startDate = this.adjustDate(startDate);
            endDate = this.adjustDate(endDate);

            //this.logger.log('ADJUSTED dates: ', startDate, endDate);
        }
        else {
            // GET DATES FROM THE APP SETTINGS
            this.logger.log('APP SETTING DATE FILTERS');
            startDate = this.getSetting('releaseStartDate');
            endDate = this.getSetting('releaseEndDate');
        }

        //this.logger.log('starting to build DATE filters');
        var filter1 = Ext.create('Rally.data.wsapi.Filter', {
                property: 'DirectChildrenCount',
                operator: '=',
                value: 0
        });
        //this.logger.log('filter1 ', filter1, filter1.toString());

        var filter2 = [
            {
                property: 'AcceptedDate',
                operator: '>=',
                value: startDate
            },
            {
                property: 'AcceptedDate',
                operator: '<=',
                value: endDate
            }
        ];
        var filter3 = [
            {
                property: 'ScheduleState',
                operator: '!=',
                value: 'Accepted'
            },
            {
                property: 'InProgressDate',
                operator: '<=',
                value: endDate
            }
        ];
        filter2 = Rally.data.wsapi.Filter.and(filter2);  //((AcceptedDate >= startDate) AND (AcceptedDate <= endDate))
        //this.logger.log('filter2 ', filter2, filter2.toString());
        filter3 = Rally.data.wsapi.Filter.and(filter3);  //(ScheduleState != Accepted) AND (InProgressDate <= endDate))
        //this.logger.log('filter3 ', filter3, filter3.toString());
        var filter4 = filter2.or(filter3);
        //this.logger.log('filter4 ', filter4, filter4.toString());
        filters = filter1.and(filter4);
        
        //this.logger.log('getFilters', filters, filters.toString());
        return filters;
    },

    adjustDate: function(isoDate){
        const utcYear = isoDate.getUTCFullYear();
        const utcMonth = isoDate.getUTCMonth()+1;
        const utcDay = isoDate.getUTCDate();
        //this.logger.log('month day year is ',utcYear, utcMonth, utcDay);

        const yyyy = utcYear;
        const mm = utcMonth.toString().padStart(2, "0");
        const dd = utcDay.toString().padStart(2, "0");
        const date = yyyy + '-' + mm + '-' + dd;

        return date;
    },

    getPortfolioName: function(){
        return this.portfolioItemTypes[0].typePath.replace('PortfolioItem/','');
    },

    getFetchList: function(){
        return [this.getPortfolioName(),'ObjectID','FormattedID','Parent','Name','PlanEstimate','AcceptedDate','InProgressDate','ScheduleState'];
    },

    getPortfolioFetchList: function(){
        return ['ObjectID','FormattedID','Parent','Name'];
    },

    updateView: function(){
        this.setLoading(true);
        Deft.Chain.pipeline([
            this.fetchWorkItems,
            this.fetchPortfolioItems
        ],this).then({
            success: this.processItems,
            failure: this.showErrorNotification,
            scope: this
        }).always(function(){ this.setLoading(false); },this);
    },

    fetchPortfolioItems: function(records){

        var featureField = this.getPortfolioName(),
            deferred = Ext.create('Deft.Deferred'),
            returnObj = {
                workItems: records
            };

        var piLevel = this.getPIBucketLevel();
        this.logger.log('fetchPortfolioItems', piLevel);
        if (piLevel === 0){
            //We have everything we need in the story record since we fetched feature and parent
            deferred.resolve(returnObj);
        } else {
            var featureOids = _.reduce(records, function(ar, r){
                if (r.get(featureField) && !Ext.Array.contains(ar, r.get(featureField).ObjectID)){
                   ar.push(r.get(featureField).ObjectID);
                }
                return ar;
            }, []);
            this.logger.log('fetchPortfolioItems featureOids', featureOids);
            if (featureOids.length === 0) {
                //None of the stories have features and we are done here
                deferred.resolve(returnObj);
            } else {
                var promises = [],
                    property = "ObjectID";
                for (var i=0; i<piLevel; i++){
                    //Todo, at some point we might want to try doing this in reverse since traversing
                    //down a collection is likely less performant than up, but then it makes the code
                    //even more complicated to allow levels above 3
                    if (i > 0){
                        property = "Children." + property;
                    }
                    var filters = Ext.Array.map(featureOids, function(f){ return {
                            property: property,
                            value: f
                        };
                    });
                    if (filters.length < this.MAX_FILTERS){
                        if (filters.length > 1){
                            filters = Rally.data.wsapi.Filter.or(filters);
                        }
                    } else {
                        //just get everything that has stories for now if there are too many filters since too many filters will slow performance.
                        filters = {
                            property: 'LeafStoryCount',
                            operator: '>',
                            value: 0
                        };
                    }

                    promises.push(this.fetchWsapiRecords({
                        model: this.portfolioItemTypes[i].typePath,
                        filters: filters,
                        fetch: this.getPortfolioFetchList(),
                        enableHttpPost: true,
                        limit: Infinity,
                        context: {project: null}
                    }));
                }
                Deft.Promise.all(promises).then({
                    success: function(results){
                        this.logger.log('fetchPortfolioItems success', results);
                        returnObj.portfolioItems = [];
                        for (var i=0; i<piLevel; i++){
                            returnObj.portfolioItems[i] = _.reduce(results[i], function(hash, p){
                                hash[p.get('ObjectID')] = p.getData();
                                return hash;
                            }, {});
                        }
                        deferred.resolve(returnObj);
                    },
                    failure: this.showErrorNotification,
                    scope: this
                });
            }
        }
        return deferred.promise;
    },

    getPIBucketLevel: function(){
        var index = -1;
        var type = this.getPortfolioItemType();
        for (var i=0; i<this.portfolioItemTypes.length; i++){
            if (this.portfolioItemTypes[i].typePath === type){
                index = i;
                i = this.portfolioItemTypes.length;
            }
        }
        return index;
    },

    getPortfolioItemTypes: function(){
        return this.portfolioItemTypes;
    },

    getPortfolioItemType: function(){
        return this.getSetting('portfolioItemType');
    },

    /**
     * processItems - lets take all the data we gathered and make it into a series for the pie chart
     * @param obj
     */
    processItems: function(obj){
        this.logger.log('processItems', obj);

        var featureField = this.getPortfolioName(),
            portfolioHash = {},
            piLevel = this.getPIBucketLevel(),
            dataMap = {},
            debug = [];

        Ext.Array.each(obj.workItems, function(w){
            var feature = w.get(featureField),
                ancestor = this.getPortfolioAncestorKey(piLevel, feature, obj.portfolioItems, dataMap),
                key = ancestor;

            if (Ext.isObject(ancestor)){
                debug.push([w.get('FormattedID'), key.FormattedID].join(','));
                key = ancestor.ObjectID;
            } else {
                debug.push([w.get('FormattedID'), key].join(','));
            }
            if (!portfolioHash[key]){
                portfolioHash[key] = {
                    data: ancestor,
                    count: 0,
                    points: 0
                };
            }
            portfolioHash[key].count++;
            portfolioHash[key].points += Number(w.get('PlanEstimate'));
        }, this);


        if (debug && this.exportDebug){
            CArABU.technicalservices.Exporter.saveAs(debug.join('\r\n'),"debugexport.csv")
        }
        this.buildChart(portfolioHash);
    },

    getPortfolioAncestorKey: function(ancestorLevel, featureObj, portfolioItems){
        //this.logger.log('getPortfolioAncestorKey', ancestorLevel, featureObj, portfolioItems);

        var noneText = "None";
        if (!featureObj){
            return noneText;
        }

        if (ancestorLevel === 0){
            return featureObj;
        }

        var ancestor = featureObj;

        for (var i=0; i<portfolioItems.length; i++){
            if (ancestor !== noneText){
                ancestor = portfolioItems[i][ancestor.ObjectID] &&
                    portfolioItems[i][ancestor.ObjectID].Parent || noneText;
            }
        }
        return ancestor;
    },

    buildChart: function(portfolioHash, dataMap){
        this.logger.log('buildChart', portfolioHash, dataMap);

        var data = [],
            unitType = this.getUnitValue();
        Ext.Object.each(portfolioHash, function(oid, obj){
            var name = obj.data;
            if (Ext.isObject(name)){
                name = Ext.String.format("{0}: {1}", name.FormattedID, name.Name);
                data.push({
                    name: name,
                    y: obj[unitType]
                });
            } else {
                //Put the 'None' at the beginning of the pack so it aligns with the gray color
                data.unshift({
                    name: name,
                    y: obj[unitType]
                });
            }
        });
        this.logger.log('buildChart', data);

        this.getDisplayBox().removeAll();
        this.getDisplayBox().add({
            xtype: 'rallychart',
            chartColors: this.chartColors,
            chartConfig: this.getChartConfig(),
            chartData: {
                series: [{
                    type: 'pie',
                    name: "User Story Allocation",
                    data:  data,
                    showInLegend: false
                }]
            }
        });

    },

    getPortfolioItemTypeName: function(){
        var piLevel = this.getPIBucketLevel();
        return this.portfolioItemTypes[piLevel] && this.portfolioItemTypes[piLevel].name;
    },

    getUnitLabel: function(){
        return this.getUnitValue() === "count" ? "stories" : "points";
    },

    getUnitValue: function(){
        return this.getSetting('calculationType') || "count";
    },

    getChartConfig: function(){
        var units = "stories";

        return {
            chart: {
                type: 'pie'
            },
            title: {
                text: "User Story Allocation by " + this.getPortfolioItemTypeName(),
                style: {
                    color: '#666',
                    fontSize: '18px',
                    fontFamily: 'ProximaNova',
                    textTransform: 'uppercase',
                    fill: '#666'
                }
            },
            tooltip: {
                backgroundColor: '#444',
                headerFormat: '',
                pointFormat: '<div class="tooltip-label"><span style="color:{point.color};width=100px;">\u25CF</span>{point.name}: {point.y} ' + this.getUnitLabel() + '</div>',
                shared: true,
                useHTML: true,
                borderColor: '#444'
            },
            plotOptions: {
                pie: {
                    dataLabels: {
                        enabled: true,
                        overflow: 'none',
                        format: '{point.name}: {point.percentage:.1f} %',
                        style: {
                            color: '#888',
                            fontSize: '11px',
                            fontFamily: 'ProximaNovaSemiBold',
                            fill: '#888'
                        }
                    },
                    showInLegend: false
                }
            }
        };
    },

    showErrorNotification: function(msg){
        Rally.ui.notify.Notifier.showError({message: msg});
    },

    fetchWorkItems: function(){
        var deferred = Ext.create('Deft.Deferred');
        this.logger.log('fetchWorkItems',this.getFilters().toString());
        Ext.create('Rally.data.wsapi.Store', {
            model: 'HierarchicalRequirement',
            filters: this.getFilters(),
            fetch: this.getFetchList(),
            limit: Infinity
        }).load({
            callback: function(records, operation){
                if (operation.wasSuccessful()){
                    deferred.resolve(records);
                } else {
                    deferred.reject("Error loading work items: " + operation.error.errors.join(','));
                }
            }
        });
        return deferred.promise;
    },

    getTimeboxScope: function(){
        return this.getContext().getTimeboxScope();
    },

    /**
     *
     * @param timeboxScope
     * This function is the callback for when the timebox selector on the dashboard changes.
     */
    onTimeboxScopeChange: function(timeboxScope) {
        if (!timeboxScope){
            timeboxScope = this.getContext().getTimeboxScope();
        }

        if(timeboxScope && timeboxScope.getType() === 'release') {
            this.getContext().setTimeboxScope(timeboxScope);
            this.updateView();
        }
    },

    getSettingsFields: function(){
        return [
            {
                xtype: 'rallyportfolioitemtypecombobox',
                name: 'portfolioItemType',
                fieldLabel: 'Portfolio Item Type',
                labelAlign: 'right',
                valueField: 'TypePath',
                labelWidth: 200
            },
            {
                xtype: 'rallycombobox',
                name: 'calculationType',
                fieldLabel: 'Calculation Type',
                labelAlign: 'right',
                labelWidth: 200,
                store: Ext.create('Rally.data.custom.Store',{
                    fields: ['_ref','_refObjectName'],
                    data: [{_ref: "count", _refObjectName: "Story Count"},{_ref: "points", _refObjectName: "Sum of Story Points"}]
                })
            },
            {
                xtype: 'label',
                text: 'By checking this box, only User Stories with the Release field explictly set will be included in the data',
                margin: '0 0 0 0'
            },
            {
                xtype: 'rallycheckboxfield',
                name: 'strictReleaseFilter',
                fieldLabel: 'Strict Release Filtering',
                labelAlign: 'right',
                labelWidth: 200
            },
            {
                xtype: 'label',
                text: 'NOTE: These Dates are IGNORED if page-level filter is used!',
                margin: '0 0 0 0'
            },
            {
                xtype: 'datefield',
                name: 'releaseStartDate',
                fieldLabel: 'Release Start Date',
                format: 'Y-m-d',
                labelAlign: 'right',
                labelWidth: 200
            },
            {
                xtype: 'datefield',
                name: 'releaseEndDate',
                fieldLabel: 'Release End Date',
                format: 'Y-m-d',
                labelAlign: 'right',
                labelWidth: 200
            }
        ];
    },

    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },

    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },

    /**
     * fetchPortfolioItemTypes
     * @returns {Deft.promise|*|r.promise|promise}
     *
     * Promise that returns the portfolio item types in hierarchical order
     *
     */
    fetchPortfolioItemTypes: function(){
        var deferred = Ext.create('Deft.Deferred');

        var store = Ext.create('Rally.data.wsapi.Store', {
            model: 'TypeDefinition',
            fetch: ['TypePath', 'Ordinal','Name'],
            filters: [{
                property: 'TypePath',
                operator: 'contains',
                value: 'PortfolioItem/'
            }],
            sorters: [{
                property: 'Ordinal',
                direction: 'ASC'
            }]
        });
        store.load({
            callback: function(records, operation, success){
                if (success){
                    var portfolioItemTypes = new Array(records.length);
                    _.each(records, function(d){
                        //Use ordinal to make sure the lowest level portfolio item type is the first in the array.
                        var idx = Number(d.get('Ordinal'));
                        portfolioItemTypes[idx] = { typePath: d.get('TypePath'), name: d.get('Name') };
                        //portfolioItemTypes.reverse();
                    });
                    deferred.resolve(portfolioItemTypes);
                } else {
                    var error_msg = '';
                    if (operation && operation.error && operation.error.errors){
                        error_msg = operation.error.errors.join(',');
                    }
                    deferred.reject('Error loading Portfolio Item Types:  ' + error_msg);
                }
            }
        });
        return deferred.promise;
    },

    /**
     * fetchWsapiRecords
     * @param config
     * @returns {Deft.Deferred}
     *
     * Generic promise wrapped to return records from the wsapi database
     */
    fetchWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');

        Ext.create('Rally.data.wsapi.Store',config).load({
            callback: function(records, operation, success){
                if (success){
                    deferred.resolve(records);
                } else {
                    deferred.reject(Ext.String.format("Error getting {0} for {1}: {2}", config.model, config.filters.toString(), operation.error.errors.join(',')));
                }
            }
        });
        return deferred;
    }
});
