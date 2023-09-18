/**
 * Sanitizes a string for a GraphQL query.
 *
 * @param string
 * @returns {Promise<string>}
 */
async function escapeForGql( string ) {
    return '_' + string.replace( /[./-]/g, '_' );
}

/**
 * Checks if a user should be skipped.
 *
 * @param {string} username Username to check.
 *
 * @return {boolean} true if the username should be skipped. false otherwise.
 */
async function skipUser( username ) {
    const skippedUsers = [ 'github-actions' ];

    if (
        -1 === skippedUsers.indexOf( username ) &&
        ! contributorAlreadyPresent( username )
    ) {
        return false;
    }

    return true;
}

/**
 * Checks if a user has already been added to the list of contributors to receive props.
 *
 * Contributors should only appear in the props list once, even when contributing in multiple ways.
 *
 * @param {string} username The username to check.
 *
 * @return {boolean} true if the username is already in the list. false otherwise.
 */
async function contributorAlreadyPresent( username ) {
    for ( const contributorType of contributorTypes ) {
        if ( contributors[ contributorType ].has( username ) ) {
            return true;
        }
    }
}

module.exports = utils;