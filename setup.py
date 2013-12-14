#!/usr/bin/env python

import os

from setuptools import setup, find_packages

try:
    # Workaround for http://bugs.python.org/issue15881
    import multiprocessing
except ImportError:
    pass

VERSION = '0.1.5'

if __name__ == '__main__':
    setup(
        name='django-datastream',
        version=VERSION,
        description="Django HTTP interface to Datastream API time-series library.",
        long_description=open(os.path.join(os.path.dirname(__file__), 'README.rst')).read(),
        author='wlan slovenija',
        author_email='open@wlan-si.net',
        url='https://github.com/wlanslovenija/django-datastream',
        license='AGPLv3',
        packages=find_packages(exclude=('*.tests', '*.tests.*', 'tests.*', 'tests')),
        package_data={},
        classifiers=[
            'Development Status :: 4 - Beta',
            'Environment :: Web Environment',
            'Intended Audience :: Developers',
            'License :: OSI Approved :: GNU Affero General Public License v3',
            'Operating System :: OS Independent',
            'Programming Language :: Python',
            'Framework :: Django',
        ],
        include_package_data=True,
        zip_safe=False,
        install_requires=[
            'Django>=1.4',
            'datastream>=0.2.6',
            'django-tastypie>=0.9.16,<=0.10.0',
            'ujson>=1.33',
            'pytz>=2012h',
            'mimeparse>=0.1.3',
        ],
        test_suite='tests.runtests.runtests',
    )
