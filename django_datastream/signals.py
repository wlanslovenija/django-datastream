from django import dispatch

new_datapoint = dispatch.Signal(providing_args=('stream_id', 'granularity', 'datapoint'))
