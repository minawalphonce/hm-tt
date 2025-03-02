module.exports = {
    apps: [{
        name: 'yarn',
        script: 'yarn',
        args: 'export start 2',
        interpreter: '/bin/bash',
        env: {
            NODE_ENV: 'development'
        }
    }]
};