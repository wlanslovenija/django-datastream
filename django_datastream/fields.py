from tastypie import fields


class DatapointsField(fields.ApiField):
    """
    A datapoints field.
    """

    dehydrated_type = 'datapoints'
    help_text = "A list of datapoints."
