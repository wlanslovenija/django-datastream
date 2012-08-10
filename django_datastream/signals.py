from django import dispatch

new_datapoint = dispatch.Signal(providing_args=('metric_id', 'granularity', 'datapoint'))
